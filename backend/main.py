# backend/main.py
from fastapi import FastAPI, HTTPException,UploadFile, File
from pydantic import BaseModel
import shutil
import os
import glob
import json
import pandas as pd
from typing import Optional, Dict, Any
from celery_worker import generate_dataset_summary, route_task, celery_app as worker
from celery.result import AsyncResult

from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from data_type_detector import detect_data_type

from redis import Redis

redis_cache = Redis(host='localhost', port=6379, db=1, decode_responses=True)

class TaskRequest(BaseModel):
    dataset_name: str
    column_name: str
    task_type: str
    task_params: Optional[Dict[str, Any]] = None

app = FastAPI()

# --- (Add your CORS Middleware configuration here) ---
origins = ["http://localhost:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_next_version_path(file_path: str) -> str:
    """
    Checks if a file exists and returns a new versioned path if it does.
    Example: 'my_data.csv' -> 'my_data (1).csv'
    """
    if not os.path.exists(file_path):
        return file_path
    
    base, ext = os.path.splitext(file_path)
    version = 1
    while True:
        new_path = f"{base} ({version}){ext}"
        if not os.path.exists(new_path):
            return new_path
        version += 1

@app.post("/upload")
async def upload_dataset(file: UploadFile = File(...)):
    # ... (your professional upload logic with versioning is the same)
    try:
        public_dir = os.path.join(os.path.dirname(__file__), '..', 'public')
        original_path = os.path.join(public_dir, file.filename)
        versioned_path = get_next_version_path(original_path)
        
        with open(versioned_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # TRIGGER THE ASYNCHRONOUS SUMMARY GENERATION for the new file
        generate_dataset_summary.delay(versioned_path)

        return { "status": "SUCCESS", "message": "File uploaded and analysis job started.", "path": f"/{os.path.basename(versioned_path)}", "name": os.path.basename(versioned_path) }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")
    
@app.post("/submit_task")
async def submit_task(request: TaskRequest):
    # The pre-flight check for row count would be added here
    
    task = worker.send_task(
        'celery_worker.route_task',
        args=[request.dataset_name, request.column_name, request.task_type, request.task_params]
    )
    return {"job_id": task.id, "status": "Job accepted."}

@app.get("/analyze/status/{job_id}")
async def get_analysis_status(job_id: str):
    task_result = AsyncResult(job_id, app=worker)
    if task_result.ready():
        if task_result.successful():
            return task_result.get() # Return the result directly
        else:
            return {"status": "FAILURE", "error": str(task_result.info)}
    else:
        return {"status": "PENDING"}
    
@app.get("/datasets")
async def get_available_datasets():
    """
    Scans the 'public' directory for all .csv files and returns them
    as a structured list for the frontend dropdown.
    """
    try:
        public_dir = os.path.join(os.path.dirname(__file__), '..', 'public')
        
        # Use glob to find all files ending with .csv
        csv_files = glob.glob(os.path.join(public_dir, "*.csv"))
        
        datasets = []
        for file_path in csv_files:
            file_name = os.path.basename(file_path)
            datasets.append({
                "name": file_name,
                "path": f"/{file_name}", # The server path the frontend will use
                "source": "server" # A clear source identifier
            })
            
        return datasets
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list datasets: {str(e)}")
    
@app.get("/datasets/dashboard-summary")
async def get_dashboard_summary():
    """
    Retrieves all summaries from the Redis cache after performing a professional-grade
    reconciliation with the filesystem to ensure data is always synchronized.
    """
    try:
        # 1. Get the Ground Truth: What files are ACTUALLY on disk?
        public_dir = os.path.join(os.path.dirname(__file__), '..', 'public')
        disk_files = {os.path.basename(p) for p in glob.glob(os.path.join(public_dir, "*.csv"))}

        # 2. Get the Current State: What datasets are in our cache?
        cached_files = {f for f in redis_cache.hkeys("dashboard_summaries")}

        # 3. Reconcile the two lists
        files_to_add = disk_files - cached_files
        for filename in files_to_add:
            print(f"CACHE SYNC: Found new file '{filename}'. Triggering background analysis.")
            file_path = os.path.join(public_dir, filename)
            generate_dataset_summary.delay(file_path)

        files_to_remove = cached_files - disk_files
        if files_to_remove:
            print(f"CACHE SYNC: Found stale files. Removing: {files_to_remove}")
            redis_cache.hdel("dashboard_summaries", *files_to_remove)

        # 4. Return the synchronized, up-to-date data from the cache
        all_summaries_json = redis_cache.hgetall("dashboard_summaries")
        summaries = [json.loads(s) for s in all_summaries_json.values()]
        return summaries
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve summaries from cache: {str(e)}")