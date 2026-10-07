import os
import json
import csv
import time
import pickle
import math
from urllib.parse import urlparse, parse_qs
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from google import genai
from google.genai import types
from dotenv import load_dotenv

PORT = 8000

# Load environment variables from the .env file
load_dotenv()

# Initialize the Gemini Client. 
try:
    client = genai.Client()
except Exception as e:
    print(f"Warning: Gemini client initialization failed. {e}")
    client = None

# =========================================================
# GEOSPATIAL ENGINE (Haversine Formula)
# =========================================================
def calculate_distance(lat1, lon1, lat2, lon2):
    if not lat1 or not lon1 or not lat2 or not lon2:
        return 0.0
    try:
        R = 6371.0 # Earth radius in kilometers
        lat1, lon1, lat2, lon2 = map(float, [lat1, lon1, lat2, lon2])
        
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        
        a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        
        return R * c # Distance in km
    except Exception:
        return 9999.0 # Fallback if coordinate parsing fails

# =========================================================
# IN-MEMORY DATA STORES
# =========================================================

bulletins = [
    {
        "id": 1,
        "title": "Flood Gate 4 Warning Notice",
        "content": "Sluice gates will release nominal overflow at 17:00 hrs. Evacuate low-lying riverbanks immediately.",
        "time": "14:00",
        "sender": "Disaster Command HQ",
        "lat": None,
        "lon": None
    }
]

mesh_messages = [
    {
        "id": 1,
        "sender": "Command Base",
        "role": "Rescue Team",
        "text": "Local mesh network active on base frequency. Keep distress calls concise.",
        "time": "14:00",
        "lat": None,
        "lon": None
    }
]

sos_beacons = [
    {
        "id": 1,
        "title": "Medical Aid - Trapped Senior Citizen",
        "category": "Medical",
        "urgency": "Critical",
        "location": "Sector 4, Community Shelter Block B",
        "time": "14:10",
        "status": "Pending",
        "sender": "Anonymous",
        "lat": None,
        "lon": None
    }
]

# =========================================================
# REQUEST HANDLER
# =========================================================

class AidBridgeHandler(SimpleHTTPRequestHandler):

    def _set_headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    # --- GET ROUTES (Now with Location Filtering) ---
    def do_GET(self):
        parsed_url = urlparse(self.path)
        clean_path = parsed_url.path
        query_params = parse_qs(parsed_url.query)
        
        # Extract requester's location from URL parameters
        req_lat = query_params.get('lat', [None])[0]
        req_lon = query_params.get('lon', [None])[0]

        # Helper to filter items beyond 400km radius
        def filter_by_distance(items):
            if not req_lat or not req_lon:
                return items
            
            filtered_list = []
            for item in items:
                i_lat = item.get('lat')
                i_lon = item.get('lon')
                
                # If both item and user have coordinates, calculate distance
                if i_lat and i_lon:
                    dist = calculate_distance(req_lat, req_lon, i_lat, i_lon)
                    if dist <= 400:
                        item['distance_away'] = round(dist, 1)
                        filtered_list.append(item)
                else:
                    # Include legacy items without location data so nothing breaks
                    filtered_list.append(item)
            return filtered_list

        if clean_path == "/api/bulletins":
            self._set_headers()
            self.wfile.write(json.dumps(filter_by_distance(bulletins)).encode("utf-8"))
        elif clean_path == "/api/messages":
            self._set_headers()
            self.wfile.write(json.dumps(filter_by_distance(mesh_messages)).encode("utf-8"))
        elif clean_path == "/api/beacons":
            self._set_headers()
            self.wfile.write(json.dumps(filter_by_distance(sos_beacons)).encode("utf-8"))
        else:
            super().do_GET()

    # --- POST ROUTES ---
    def do_POST(self):
        clean_path = self.path.split('?')[0]
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        
        try:
            payload = json.loads(raw_body)
        except Exception:
            payload = {}

        # 1. Citizen Registration (Stored in True Binary Form using Pickle)
        if clean_path == "/api/citizen-login":
            name = payload.get("name", "Unknown")
            age = payload.get("age", "")
            phone = payload.get("phone", "")
            
            try:
                base_dir = os.path.dirname(os.path.abspath(__file__))
                file_path = os.path.join(base_dir, "logindetails.dat")
                
                citizen_packet = {
                    "name": name,
                    "age": age,
                    "phone": phone
                }
                
                with open(file_path, "ab") as f:
                    pickle.dump(citizen_packet, f)
                    f.flush()
                    os.fsync(f.fileno())
                    
                print(f"✅ Successfully wrote binary citizen login to: {file_path}")
            except Exception as e:
                print(f"❌ CRITICAL ERROR writing binary login details: {e}")

            self._set_headers(200)
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))

        # 2. Rescuer Verification (Strict Team & Credential Matching from CSV)
        elif clean_path == "/api/rescue-login":
            officer_id = payload.get("id", "").strip().lower()
            password = payload.get("pass", "").strip()
            selected_team = payload.get("team", "").strip()
            
            authenticated = False
            officer_name = officer_id
            error_message = "Invalid responder ID or password."

            if os.path.exists("rescue.csv"):
                try:
                    with open("rescue.csv", mode="r", encoding="utf-8") as f:
                        reader = csv.reader(f)
                        header = next(reader, None) # Skip header row
                        
                        for row in reader:
                            if len(row) >= 4:
                                file_id = row[0].strip().lower()
                                file_pass = row[1].strip()
                                file_name = row[2].strip()
                                file_team = row[3].strip()
                                
                                if file_id == officer_id and file_pass == password:
                                    if selected_team.lower() in file_team.lower() or file_team.lower() in selected_team.lower():
                                        authenticated = True
                                        officer_name = file_name
                                    else:
                                        error_message = f"Access Denied: Invalid login details entered, please try again."
                                    break
                except Exception as e:
                    print(f"CSV read error: {e}")

            self._set_headers(200)
            self.wfile.write(json.dumps({
                "authenticated": authenticated,
                "name": officer_name,
                "message": "" if authenticated else error_message
            }).encode("utf-8"))

        # 3. Citizen SOS Beacon Broadcast (With Keyword Auto-Scoring & Location)
        elif clean_path == "/api/beacons":
            title = payload.get("title", "SOS Alert")
            category = payload.get("category", "General")
            urgency = payload.get("urgency", "High")
            
            critical_keywords = ["bleed", "trapped", "infant", "baby", "fire", "unconscious", "heart", "choke", "choking", "drown", "collapse", "breath"]
            title_lower = title.lower()
            
            if category == "Rescue" or any(keyword in title_lower for keyword in critical_keywords):
                urgency = "Critical"
                print(f"🚨 AUTO-SCALED BEACONS TO CRITICAL: '{title}' matched emergency keyword rules.")

            new_beacon = {
                "id": len(sos_beacons) + 1,
                "title": title,
                "category": category,
                "urgency": urgency,
                "location": payload.get("location", "Unknown Location"),
                "lat": payload.get("lat"),
                "lon": payload.get("lon"),
                "time": payload.get("time", "Now"),
                "status": "Pending",
                "sender": payload.get("sender", "Unknown") 
            }
            sos_beacons.insert(0, new_beacon)
            self._set_headers(200)
            self.wfile.write(json.dumps({"success": True, "beacon": new_beacon}).encode("utf-8"))

        # 4. Responder Incident Resolution
        elif clean_path == "/api/resolve-beacon":
            beacon_id = payload.get("id")
            for b in sos_beacons:
                if b.get("id") == beacon_id:
                    b["status"] = "Resolved"
                    break
            self._set_headers(200)
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))

        # 5. Official Crisis Bulletin Broadcast (With Location)
        elif clean_path == "/api/bulletins":
            new_bulletin = {
                "id": len(bulletins) + 1,
                "title": payload.get("title", "Emergency Broadcast"),
                "content": payload.get("content", ""),
                "lat": payload.get("lat"),
                "lon": payload.get("lon"),
                "time": payload.get("time", "Now"),
                "sender": payload.get("sender", "Command")
            }
            bulletins.insert(0, new_bulletin)
            self._set_headers(200)
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))

        # 6. Mesh Radio Message (With Location)
        elif clean_path == "/api/messages":
            new_msg = {
                "id": len(mesh_messages) + 1,
                "sender": payload.get("sender", "Anonymous"),
                "role": payload.get("role", "Citizen"),
                "text": payload.get("text", ""),
                "lat": payload.get("lat"),
                "lon": payload.get("lon"),
                "time": payload.get("time", "Now")
            }
            mesh_messages.append(new_msg)
            self._set_headers(200)
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))

        # 7. Real AI Triage Query using Gemini (Optimized for Speed)
        elif clean_path == "/api/chat":
            msg = payload.get("message", "").strip()
            response_text = "System is currently unavailable. Stay safe and broadcast an SOS beacon."

            if client and msg:
                sys_prompt = "You are LifeLine AI, a concise, highly efficient emergency survival and first aid assistant. Keep responses short, direct, and actionable. Focus entirely on safety, survival, and first aid. Do not use formatting like markdown tables or large text blocks; use simple, short paragraphs."
                
                supported_models = [
                    'gemini-flash-latest',
                    'gemini-3.1-flash-lite',
                    'gemini-3.7-flash'
                ]
                
                max_retries = 2
                success = False
                
                for model_name in supported_models:
                    if success:
                        break
                        
                    for attempt in range(max_retries):
                        try:
                            ai_response = client.models.generate_content(
                                model=model_name,
                                contents=msg,
                                config=types.GenerateContentConfig(
                                    system_instruction=sys_prompt,
                                    temperature=0.2, 
                                )
                            )
                            response_text = ai_response.text
                            print(f"✅ Success! Responded using: {model_name} on attempt {attempt + 1}")
                            success = True
                            break  
                            
                        except Exception as e:
                            error_msg = str(e)
                            print(f"⚠ {model_name} failed. Error: {error_msg}")
                            break
                                
                if not success:
                    print("❌ CRITICAL: All AI models failed.")
                    response_text = "Network interference detected across all AI servers. Stay secure and broadcast your coordinates."

            self._set_headers(200)
            self.wfile.write(json.dumps({"response": response_text}).encode("utf-8"))

        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode("utf-8"))

# =========================================================
# RUNTIME STARTUP
# =========================================================

if __name__ == "__main__":
    server_address = ("0.0.0.0", PORT)
    httpd = ThreadingHTTPServer(server_address, AidBridgeHandler)
    print(f"🚀 AidBridge Server running at http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n Shutting down server.")
        httpd.server_close()