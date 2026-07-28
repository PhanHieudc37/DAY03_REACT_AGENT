import base64, io, json, os, uuid, zipfile
from datetime import datetime, timezone
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from gridfs import GridFS
from pymongo import ASCENDING, MongoClient
import requests

app=FastAPI(title="RecruitFlow Mongo API",version="1.0.0")
app.add_middleware(CORSMiddleware,allow_origins=["http://localhost:3000","http://localhost:3001","http://localhost:3002"],allow_methods=["*"],allow_headers=["*"])
client=MongoClient(os.getenv("MONGODB_URI","mongodb://localhost:27017/recruitflow"))
db=client.get_default_database(); fs=GridFS(db)

def now(): return datetime.now(timezone.utc)
def clean(doc):
    if not doc:return None
    doc=dict(doc);doc["_id"]=str(doc["_id"])
    for k,v in list(doc.items()):
        if isinstance(v,datetime):doc[k]=v.isoformat()
    return doc
def validate_criteria(c):
    total=sum(float(v) for v in c["weights"].values())
    if abs(total-100)>.01:raise HTTPException(400,f"Tổng trọng số phải bằng 100% (hiện {total}%).")
    if not c.get("title") or not c.get("must_have_skills"):raise HTTPException(400,"Thiếu tên vị trí hoặc kỹ năng bắt buộc.")
    thresholds=c.get("thresholds",{"high":80,"review":60});high=float(thresholds.get("high",80));review=float(thresholds.get("review",60))
    if review<0 or high>100 or review>=high:raise HTTPException(400,"Ngưỡng xem xét phải nhỏ hơn ngưỡng phù hợp cao.")
    c["thresholds"]={"high":high,"review":review}
    c["job_id"]=c.get("job_id") or f"job_{uuid.uuid4().hex[:8]}";c["updated_at"]=now()
    return c
def score(candidate,c):
    skills={x.lower() for x in candidate.get("skills",[])};must=[x.lower() for x in c["must_have_skills"]];nice=[x.lower() for x in c.get("nice_to_have_skills",[])]
    matched=[x for x in must if x in skills];missing=[x for x in must if x not in skills];matched_nice=[x for x in nice if x in skills]
    ss=round(80*len(matched)/max(len(must),1)+20*len(matched_nice)/max(len(nice),1),1)
    ideal=max(float(c.get("ideal_experience_years") or c["min_experience_years"]),1);es=min(100,round(float(candidate.get("experience_years",0))/ideal*100))
    levels={"high_school":1,"college":2,"bachelor":3,"master":4,"phd":5};cl=max([levels.get(x.get("degree",""),0) for x in candidate.get("education",[])]+[0]);need=levels.get(c["min_education"],1);eds=100 if cl>=need else round(cl/need*100)
    certs={x.lower() for x in candidate.get("certifications",[])};required_certs=[x.lower() for x in c.get("required_certifications",[])];cert_ratio=len([x for x in required_certs if x in certs])/max(len(required_certs),1) if required_certs else 1
    majors=[x.lower() for x in c.get("preferred_majors",[])];major_match=not majors or any(any(m in x.get("major","").lower() for m in majors) for x in candidate.get("education",[]));other=round(100*(.6*cert_ratio+.4*(1 if major_match else 0)));w=c["weights"]
    total=round(ss*w["skills"]/100+es*w["experience"]/100+eds*w["education"]/100+other*w["other"]/100,1)
    screening=(c.get("screening_questions") or [{}])[0];failed_screening=bool(screening.get("hard_filter") and candidate.get("screening_answer") and candidate.get("screening_answer")!=screening.get("required_answer"))
    hard_rejected=bool(missing) or failed_screening;high=c["thresholds"]["high"];review=c["thresholds"]["review"]
    if not hard_rejected and total>=high:tier,label,action,stage,email="high","Phù hợp cao","Đưa vào danh sách hẹn phỏng vấn","interview_ready","not_required"
    elif not hard_rejected and total>=review:tier,label,action,stage,email="review","Cần xem xét","Đưa vào hàng chờ HR review","review_queue","not_required"
    else:tier,label,action,stage,email="rejected","Không phù hợp","Tự động loại và chuẩn bị email từ chối","rejected","rejection_pending"
    return {"match_score":total,"breakdown":{"skills_score":ss,"experience_score":es,"education_score":eds,"other_score":other},"missing_must_have":missing,"matched_nice_to_have":matched_nice,"hard_rejected":hard_rejected,"tier":tier,"recommendation":label,"next_action":action,"stage":stage,"email_status":email,"explanation":(f"Loại cứng vì thiếu kỹ năng bắt buộc: {', '.join(missing)}." if missing else "Loại cứng vì câu trả lời sàng lọc không đạt yêu cầu.") if hard_rejected else f"Khớp đủ kỹ năng bắt buộc; {candidate.get('experience_years',0)}/{ideal} năm kinh nghiệm lý tưởng; tổng {total}/100."}
def parse_cv(content,content_type,extra):
    key=os.getenv("GEMINI_API_KEY")
    if not key:raise HTTPException(503,"Chưa cấu hình GEMINI_API_KEY cho API.")
    prompt='Trích xuất CV thành JSON thuần: {"full_name":"","email":"","phone":"","skills":[],"experience_years":0,"experience_domains":[],"certifications":[],"languages":[{"language":"","level":""}],"work_history":[{"company":"","role":"","duration":""}],"education":[{"degree":"high_school|college|bachelor|master|phd","school":"","major":""}]}. Không bịa dữ liệu.'
    url=f"https://generativelanguage.googleapis.com/v1beta/models/{os.getenv('LLM_MODEL','gemini-2.5-flash')}:generateContent?key={key}"
    payload={"contents":[{"parts":[{"text":prompt},{"inline_data":{"mime_type":content_type or "application/pdf","data":base64.b64encode(content).decode()}}]}],"generationConfig":{"responseMimeType":"application/json","temperature":0}}
    res=requests.post(url,json=payload,timeout=60)
    if not res.ok:raise HTTPException(422,"Gemini không đọc được CV này.")
    data=json.loads(res.json()["candidates"][0]["content"]["parts"][0]["text"]);data.update(extra);return data
@app.on_event("startup")
def setup():
    db.jobs.create_index([("job_id",ASCENDING)],unique=True);db.candidates.create_index([("candidate_id",ASCENDING)],unique=True);db.applications.create_index([("application_id",ASCENDING)],unique=True);db.interviews.create_index([("interview_id",ASCENDING)],unique=True);db.interview_invites.create_index([("invite_id",ASCENDING)],unique=True)
@app.get("/health")
def health():client.admin.command("ping");return {"ok":True,"database":"mongodb","collections":db.list_collection_names()}
@app.get("/dashboard")
def dashboard():return {"ok":True,"counts":{"jobs":db.jobs.count_documents({}),"candidates":db.candidates.count_documents({}),"applications":db.applications.count_documents({}),"interviews":db.interviews.count_documents({})},"jobs":[clean(x) for x in db.jobs.find().sort("updated_at",-1).limit(10)],"candidates":[clean(x) for x in db.candidates.find().sort("created_at",-1).limit(20)],"applications":[clean(x) for x in db.applications.find().sort("created_at",-1).limit(100)],"interviews":[clean(x) for x in db.interviews.find().sort("scheduled_time",-1).limit(100)],"invites":[clean(x) for x in db.interview_invites.find().sort("created_at",-1).limit(100)]}
@app.post("/jobs")
def save_job(payload:dict):
    c=validate_criteria(payload);db.jobs.update_one({"job_id":c["job_id"]},{"$set":c},upsert=True);return {"ok":True,"criteria":clean(db.jobs.find_one({"job_id":c["job_id"]}))}
@app.post("/applications")
async def application(file:UploadFile=File(...),criteria:str=Form(...),cover_letter:str=Form(""),expected_salary:str=Form(""),available_date:str=Form(""),screening_answer:str=Form("")):
    c=validate_criteria(json.loads(criteria));db.jobs.update_one({"job_id":c["job_id"]},{"$set":c},upsert=True)
    content=await file.read()
    if len(content)>10*1024*1024:raise HTTPException(413,"CV vượt quá 10 MB.")
    extra={"cover_letter":cover_letter,"expected_salary":expected_salary,"available_date":available_date,"screening_answer":screening_answer}
    def process_one(data,filename,mime):
        file_id=fs.put(data,filename=filename,content_type=mime,uploaded_at=now())
        cand=parse_cv(data,mime,extra);cand.update({"candidate_id":f"cand_{uuid.uuid4().hex[:8]}","cv_file_id":str(file_id),"cv_filename":filename,"created_at":now()});db.candidates.insert_one(cand)
        matching=score(cand,c);app_id=f"app_{uuid.uuid4().hex[:8]}";application={"application_id":app_id,"candidate_id":cand["candidate_id"],"job_id":c["job_id"],**matching,"hr_approved":False,"created_at":now()};db.applications.insert_one(application)
        return clean(cand),clean(application)
    if (file.filename or "").lower().endswith(".zip"):
        results=[];errors=[];allowed={".pdf",".doc",".docx",".jpg",".jpeg",".png",".txt"}
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                for info in archive.infolist():
                    ext=os.path.splitext(info.filename)[1].lower()
                    if info.is_dir() or ext not in allowed:continue
                    try:
                        data=archive.read(info)
                        if len(data)>10*1024*1024:raise ValueError("File vượt quá 10 MB")
                        mime={"pdf":"application/pdf","docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","jpg":"image/jpeg","jpeg":"image/jpeg","png":"image/png","txt":"text/plain"}.get(ext[1:],"application/octet-stream")
                        cand,matching=process_one(data,os.path.basename(info.filename),mime);results.append({**matching,"full_name":cand.get("full_name"),"cv_filename":os.path.basename(info.filename),"cv_file_url":f"gridfs://{cand.get('cv_file_id')}"})
                    except Exception as exc:errors.append({"filename":info.filename,"reason":str(exc)})
        except zipfile.BadZipFile:raise HTTPException(422,"File ZIP bị hỏng hoặc không đọc được.")
        return {"ok":True,"batch_id":f"batch_{uuid.uuid4().hex[:10]}","job_id":c["job_id"],"total_files":len(results)+len(errors),"results":results,"errors":errors}
    cand,application=process_one(content,file.filename,file.content_type)
    return {"ok":True,"parsed_candidate":cand,"matching":application}
@app.post("/interviews")
def interview(payload:dict):
    if not payload.get("hr_approved"):raise HTTPException(400,"HR phải duyệt ứng viên trước khi đặt lịch.")
    application=db.applications.find_one({"application_id":payload.get("application_id")})
    if not application:raise HTTPException(404,"Application không tồn tại.")
    interview={"interview_id":f"int_{uuid.uuid4().hex[:8]}","application_id":payload["application_id"],"scheduled_time":payload["scheduled_time"],"interviewer":payload["interviewer"],"duration_minutes":int(payload["duration_minutes"]),"meeting_link":"https://meet.google.com/demo-room","calendar_event_id":f"cal_evt_{uuid.uuid4().hex[:8]}","status":"confirmed","created_at":now()}
    db.interviews.insert_one(interview);db.applications.update_one({"application_id":payload["application_id"]},{"$set":{"hr_approved":True,"stage":"interview_scheduled"}});return {"ok":True,"interview":clean(interview)}

@app.post("/interview-actions")
def interview_actions(payload:dict):
    action=payload.get("action")
    if action=="approve_application":
        result=db.applications.update_one({"application_id":payload.get("application_id")},{"$set":{"hr_approved":True,"stage":"interview_ready","approved_at":now()}})
        if not result.matched_count:raise HTTPException(404,"Application không tồn tại.")
        return {"ok":True,"application":clean(db.applications.find_one({"application_id":payload.get("application_id")}))}
    if action=="create_invite":
        application=db.applications.find_one({"application_id":payload.get("application_id")})
        if not application:raise HTTPException(404,"Application không tồn tại.")
        interviewer_ids=payload.get("interviewer_ids") or ["interviewer_003"];duration=int(payload.get("interview_duration_minutes",45))
        base=["2026-08-01T09:00:00+07:00","2026-08-01T14:00:00+07:00","2026-08-02T10:00:00+07:00","2026-08-03T14:00:00+07:00"]
        busy={x["scheduled_time"] for x in db.interviews.find({"interviewer_ids":{"$in":interviewer_ids},"status":{"$nin":["cancelled"]}},{"scheduled_time":1})}
        slots=[x for x in base if x not in busy][:3];invite_id=f"invite_{uuid.uuid4().hex[:8]}"
        invite={"invite_id":invite_id,"application_id":application["application_id"],"candidate_id":application["candidate_id"],"job_id":application["job_id"],"interviewer_ids":interviewer_ids,"interview_duration_minutes":duration,"interview_type":payload.get("interview_type","online"),"interview_round":int(payload.get("interview_round",1)),"available_slots":slots,"booking_link":f"http://localhost:3000/schedule/{invite_id}","status":"sent_to_candidate","delivery_mode":"simulated","created_at":now()}
        db.interview_invites.insert_one(invite);db.applications.update_one({"application_id":application["application_id"]},{"$set":{"hr_approved":True,"stage":"interview_invited","approved_at":now()}})
        return {"ok":True,"invite":clean(invite)}
    if action=="confirm_slot":
        invite=db.interview_invites.find_one({"invite_id":payload.get("invite_id")})
        if not invite:raise HTTPException(404,"Lời mời không tồn tại.")
        slot=payload.get("chosen_slot")
        if slot not in invite.get("available_slots",[]):raise HTTPException(409,"Khung giờ không còn khả dụng.")
        conflict=db.interviews.find_one({"scheduled_time":slot,"interviewer_ids":{"$in":invite["interviewer_ids"]},"status":{"$nin":["cancelled"]}})
        if conflict:raise HTTPException(409,"Khung giờ vừa được người khác chọn.")
        item={"interview_id":f"int_{uuid.uuid4().hex[:8]}","application_id":invite["application_id"],"candidate_id":invite["candidate_id"],"job_id":invite["job_id"],"invite_id":invite["invite_id"],"scheduled_time":slot,"interviewer_ids":invite["interviewer_ids"],"interviewer":"Trần Thị B","interview_type":invite["interview_type"],"interview_round":invite["interview_round"],"duration_minutes":invite["interview_duration_minutes"],"meeting_link":"https://meet.google.com/demo-room","calendar_event_id":f"cal_evt_{uuid.uuid4().hex[:8]}","status":"confirmed","reminders_scheduled":["24h_before","1h_before"],"integration_mode":"simulated","created_at":now()}
        db.interviews.insert_one(item);db.interview_invites.update_one({"invite_id":invite["invite_id"]},{"$set":{"status":"booked","chosen_slot":slot}});db.applications.update_one({"application_id":invite["application_id"]},{"$set":{"stage":"interview_scheduled"}})
        return {"ok":True,"interview":clean(item)}
    interview=db.interviews.find_one({"interview_id":payload.get("interview_id")})
    if not interview:raise HTTPException(404,"Lịch phỏng vấn không tồn tại.")
    if action=="reschedule":
        slot=payload.get("chosen_slot");conflict=db.interviews.find_one({"_id":{"$ne":interview["_id"]},"scheduled_time":slot,"interviewer_ids":{"$in":interview.get("interviewer_ids",[])},"status":{"$nin":["cancelled"]}})
        if conflict:raise HTTPException(409,"Người phỏng vấn đã bận ở khung giờ này.")
        db.interviews.update_one({"_id":interview["_id"]},{"$set":{"scheduled_time":slot,"status":"confirmed","calendar_sync_status":"updated","updated_at":now()}});return {"ok":True,"interview":clean(db.interviews.find_one({"_id":interview["_id"]}))}
    if action=="cancel":
        db.interviews.update_one({"_id":interview["_id"]},{"$set":{"status":"cancelled","calendar_sync_status":"cancelled","updated_at":now()}});return {"ok":True,"interview":clean(db.interviews.find_one({"_id":interview["_id"]}))}
    if action=="remind":
        db.interviews.update_one({"_id":interview["_id"]},{"$set":{"last_reminder_at":now(),"reminder_delivery":"simulated"}});return {"ok":True,"message":"Đã tạo nhắc lịch mô phỏng."}
    if action=="complete":
        db.interviews.update_one({"_id":interview["_id"]},{"$set":{"status":"completed","completed_at":now()}});return {"ok":True,"interview":clean(db.interviews.find_one({"_id":interview["_id"]}))}
    if action=="submit_feedback":
        feedback={k:payload.get(k) for k in ["interviewer_id","technical_score","soft_skill_score","overall_rating","notes","result"]};feedback["submitted_at"]=now()
        result=payload.get("result","");result_lower=result.lower();next_action="schedule_round_2" if "vòng 2" in result_lower or "vong 2" in result_lower else "offer_review" if result in ["Đạt","Dat"] else "close_application"
        stage="interview_1_completed" if int(interview.get("interview_round",1))==1 else f"interview_{interview.get('interview_round')}_completed"
        db.interviews.update_one({"_id":interview["_id"]},{"$set":{"status":"completed","feedback":feedback}})
        db.applications.update_one({"application_id":interview["application_id"]},{"$set":{"stage":stage,"next_action":next_action,"final_status":"in_progress" if next_action!="close_application" else "rejected"}})
        return {"ok":True,"application_id":interview["application_id"],"stage":stage,"next_action":next_action,"final_status":"in_progress" if next_action!="close_application" else "rejected"}
    raise HTTPException(400,"Action phỏng vấn không hợp lệ.")
