# backend/main.py
from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
import shutil
import os
import glob
import json
from typing import Optional, Dict, Any

from fastapi.staticfiles import StaticFiles
from celery_worker import generate_dataset_summary, route_task, celery_app as worker, generate_dataset_statistics
from celery.result import AsyncResult
from fastapi.middleware.cors import CORSMiddleware
from redis import Redis

# --- PROFESSIONAL PRACTICE: Load configuration from environment variables ---
# This resolves the "yellow underline" by removing hardcoded values.
# It uses sensible defaults if the environment variables are not set.
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_DB_CACHE = int(os.getenv("REDIS_DB_CACHE", 1))

# --- PROFESSIONAL PRACTICE: Add type hint for the Redis client ---
# This also helps resolve the "yellow underline" by making the type explicit.
redis_cache: Redis = Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB_CACHE, decode_responses=True)

app = FastAPI()

origins = ["http://localhost:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

public_dir = os.path.join(os.path.dirname(__file__), '..', 'public')

# --- FIX: Update the Pydantic model to include the optional task_params ---
# This ensures the request model matches what the celery task expects.
class TaskRequest(BaseModel):
    dataset_name: str
    column_name: str
    task_type: str
    task_params: Optional[Dict[str, Any]] = None

def get_next_version_path(file_path: str) -> str:
    if not os.path.exists(file_path):
        return file_path
    base, ext = os.path.splitext(file_path)
    version = 1
    while True:
        new_path = f"{base} ({version}){ext}"
        if not os.path.exists(new_path):
            return new_path
        version += 1

# --- FIX: Add /api prefix to all API routes ---
# This prevents conflicts with the static file server.

@app.post("/api/upload")
async def upload_dataset(file: UploadFile = File(...)):
    try:
        original_path = os.path.join(public_dir, file.filename)
        versioned_path = get_next_version_path(original_path)
        with open(versioned_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        generate_dataset_summary.delay(versioned_path)
        return {"status": "SUCCESS", "message": "File uploaded", "path": f"/{os.path.basename(versioned_path)}", "name": os.path.basename(versioned_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")

@app.get("/api/datasets")
async def get_available_datasets():
    try:
        csv_files = glob.glob(os.path.join(public_dir, "*.csv"))
        datasets = []
        for file_path in csv_files:
            file_name = os.path.basename(file_path)
            datasets.append({"name": file_name, "path": f"/{file_name}", "source": "server"})
        return datasets
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list datasets: {str(e)}")

@app.get("/api/datasets/dashboard-summary")
async def get_dashboard_summary():
    try:
        disk_files = {os.path.basename(p) for p in glob.glob(os.path.join(public_dir, "*.csv"))}
        cached_files = {f for f in redis_cache.hkeys("dashboard_summaries")}
        files_to_add = disk_files - cached_files
        for filename in files_to_add:
            file_path = os.path.join(public_dir, filename)
            generate_dataset_summary.delay(file_path)
        files_to_remove = cached_files - disk_files
        if files_to_remove:
            redis_cache.hdel("dashboard_summaries", *files_to_remove)
        all_summaries_json = redis_cache.hgetall("dashboard_summaries")
        summaries = [json.loads(s) for s in all_summaries_json.values()]
        return summaries
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve summaries from cache: {str(e)}")

@app.post("/api/submit_task")
async def submit_task(request: TaskRequest):
    task = worker.send_task(
        'celery_worker.route_task',
        args=[request.dataset_name, request.column_name, request.task_type, request.task_params]
    )
    return {"job_id": task.id, "status": "Job accepted."}

@app.get("/api/analyze/status/{job_id}")
async def get_analysis_status(job_id: str):
    task_result = AsyncResult(job_id, app=worker)
    if task_result.ready():
        if task_result.successful():
            return task_result.get()
        else:
            return {"status": "FAILURE", "error": str(task_result.info)}
    else:
        return {"status": "PENDING"}

@app.post("/api/statistics/{dataset_name}")
async def start_statistics_generation(dataset_name: str):
    try:
        file_path = os.path.join(public_dir, dataset_name)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Dataset not found.")
        task = generate_dataset_statistics.delay(file_path)
        return {"job_id": task.id, "status": "Statistics generation job started."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/statistics/status/{job_id}")
async def get_statistics_status(job_id: str):
    task_result = AsyncResult(job_id, app=worker)
    if task_result.ready():
        if task_result.successful():
            return task_result.get()
        else:
            return {"status": "FAILURE", "error": str(task_result.info)}
    else:
        return {"status": "PENDING"}

# --- STATIC FILE SERVING: This MUST be the last mounted app. ---
# It serves files like data.csv from the root, while /api/... routes are handled above.
app.mount("/", StaticFiles(directory=public_dir, html=True), name="public")