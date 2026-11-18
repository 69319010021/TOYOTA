from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from database import supabase

app = FastAPI(title="Training Registration System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.get("/api/sessions")
def get_sessions():
    result = supabase.table("training_sessions") \
        .select("*") \
        .order("training_date") \
        .execute()

    return result.data


@app.get("/api/registrations")
def get_registrations():
    result = supabase.table("registrations") \
        .select("*, participants(*), training_sessions(*)") \
        .execute()

    return result.data


@app.post("/api/register")
def register(data: dict):
    result = supabase.rpc(
        "register_training",
        {
            "p_session_id": data["session_id"],
            "p_full_name": data["full_name"],
            "p_email": data["email"],
            "p_phone": data["phone"]
        }
    ).execute()

    return result.data


@app.post("/api/cancel/{registration_id}")
def cancel_registration(registration_id: str):
    result = supabase.table("registrations") \
        .update({
            "status": "cancelled"
        }) \
        .eq("id", registration_id) \
        .execute()

    return {
        "success": True,
        "message": "ยกเลิกการลงทะเบียนสำเร็จ",
        "data": result.data
    }


@app.post("/api/sessions")
def create_session(data: dict):
    result = supabase.table("training_sessions") \
        .insert(data) \
        .execute()

    return result.data


@app.get("/")
def home():
    return FileResponse("../frontend/index.html")