from pathlib import Path
from datetime import datetime, timezone
import os
import secrets

from fastapi import FastAPI, HTTPException, Header, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from database import supabase

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

app = FastAPI(title="TOYOTA Training Registration System", version="1.0.0")

# Same-origin deployment is used; CORS remains open for local testing/API tools.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


def require_admin(x_admin_token: str | None = Header(default=None)):
    expected = os.getenv("ADMIN_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="ยังไม่ได้ตั้งค่า ADMIN_TOKEN ใน Environment Variables")
    if not x_admin_token or not secrets.compare_digest(x_admin_token, expected):
        raise HTTPException(status_code=401, detail="รหัสผู้ดูแลไม่ถูกต้อง")
    return True


def _single_or_list(data):
    if isinstance(data, list) and len(data) == 1:
        return data[0]
    return data


@app.get("/", include_in_schema=False)
def home():
    index_file = FRONTEND_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์ frontend/index.html")
    return FileResponse(str(index_file))


@app.get("/api/health")
def health():
    return {"success": True, "message": "TOYOTA API is running"}


@app.get("/api/sessions")
def get_sessions():
    sessions_result = (
        supabase.table("training_sessions")
        .select("*")
        .order("training_date")
        .execute()
    )
    sessions = sessions_result.data or []
    if not sessions:
        return []

    registration_result = (
        supabase.table("registrations")
        .select("session_id")
        .eq("status", "registered")
        .execute()
    )
    counts = {}
    for row in registration_result.data or []:
        key = row.get("session_id")
        counts[key] = counts.get(key, 0) + 1

    output = []
    for session in sessions:
        capacity = int(session.get("capacity") or 0)
        registered = counts.get(session.get("id"), 0)
        output.append({
            **session,
            "registered_count": registered,
            "seats_available": max(0, capacity - registered),
        })
    return output


@app.post("/api/register")
def register(data: dict):
    required = ["session_id", "full_name", "email", "phone"]
    missing = [field for field in required if not str(data.get(field, "")).strip()]
    if missing:
        raise HTTPException(status_code=422, detail=f"กรุณากรอกข้อมูล: {', '.join(missing)}")

    result = supabase.rpc(
        "register_training",
        {
            "p_session_id": data["session_id"],
            "p_full_name": data["full_name"].strip(),
            "p_email": data["email"].strip().lower(),
            "p_phone": data["phone"].strip(),
        },
    ).execute()
    payload = _single_or_list(result.data)
    if isinstance(payload, dict) and payload.get("success") is False:
        raise HTTPException(status_code=409, detail=payload.get("message", "ไม่สามารถลงทะเบียนได้"))
    return payload


def _find_registration(registration_id: str):
    result = (
        supabase.table("registrations")
        .select("id,status,participant_id,participants(email)")
        .eq("id", registration_id)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


def _cancel_registration(registration_id: str):
    row = _find_registration(registration_id)
    if not row:
        raise HTTPException(status_code=404, detail="ไม่พบรายการลงทะเบียน")
    if row.get("status") == "cancelled":
        raise HTTPException(status_code=409, detail="รายการนี้ถูกยกเลิกไปแล้ว")
    result = (
        supabase.table("registrations")
        .update({"status": "cancelled", "cancelled_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", registration_id)
        .execute()
    )
    return {"success": True, "message": "ยกเลิกการลงทะเบียนสำเร็จ", "data": result.data}


@app.post("/api/cancel/{registration_id}")
def cancel_registration(registration_id: str, email: str = Query(..., min_length=3)):
    row = _find_registration(registration_id)
    if not row:
        raise HTTPException(status_code=404, detail="ไม่พบรายการลงทะเบียน")
    participant = row.get("participants") or {}
    if isinstance(participant, list):
        participant = participant[0] if participant else {}
    saved_email = str(participant.get("email") or "").strip().lower()
    if not saved_email or not secrets.compare_digest(saved_email, email.strip().lower()):
        raise HTTPException(status_code=403, detail="อีเมลไม่ตรงกับข้อมูลที่ใช้ลงทะเบียน")
    return _cancel_registration(registration_id)


@app.post("/api/admin/sessions", dependencies=[Depends(require_admin)])
def admin_create_session(data: dict):
    required = ["title", "training_date", "location", "capacity"]
    missing = [field for field in required if not str(data.get(field, "")).strip()]
    if missing:
        raise HTTPException(status_code=422, detail=f"กรุณากรอกข้อมูล: {', '.join(missing)}")
    try:
        capacity = int(data["capacity"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="จำนวนที่นั่งต้องเป็นตัวเลข")
    if capacity < 1:
        raise HTTPException(status_code=422, detail="จำนวนที่นั่งต้องมากกว่า 0")

    payload = {
        "title": str(data["title"]).strip(),
        "description": str(data.get("description") or "").strip(),
        "training_date": data["training_date"],
        "location": str(data["location"]).strip(),
        "capacity": capacity,
    }
    result = supabase.table("training_sessions").insert(payload).execute()
    return result.data


@app.get("/api/admin/registrations", dependencies=[Depends(require_admin)])
def admin_get_registrations():
    result = (
        supabase.table("registrations")
        .select("id,status,registered_at,cancelled_at,participants(full_name,email,phone),training_sessions(title,training_date)")
        .order("registered_at", desc=True)
        .execute()
    )
    return result.data


@app.post("/api/admin/registrations/{registration_id}/cancel", dependencies=[Depends(require_admin)])
def admin_cancel_registration(registration_id: str):
    return _cancel_registration(registration_id)
