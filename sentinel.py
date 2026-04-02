import os
import sys
import warnings
from google import genai
try:
    import PIL.Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

warnings.filterwarnings("ignore")

# Initialize with your verified 2.5 Flash Key
client = genai.Client(api_key="AIzaSyBJFXJoe8OdSsiSD-odRvAQksZikzTukfQ")
MODEL_ID = "gemini-2.0-flash" # Optimized for high-speed logic and vision

# Updated IGNORE list for the Nexus-Planning structure
IGNORE = {'.git', 'node_modules', '__pycache__', 'dist', 'AI_FEEDBACK.md', 'sentinel.py', '.env'}

def run_analysis():
    message_parts = []
    codebase_text = "--- CODEBASE & PLAN ---\n"
    
    print("--- SENTINEL: Scanning project for files and images... ---")

    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in IGNORE]
        for file in files:
            file_path = os.path.join(root, file)
            
            # HANDLE TEXT/CODE FILES
            if file.endswith(('.py', '.js', '.md', '.html', '.css', '.json')):
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        codebase_text += f"\n\n--- FILE: {file_path} ---\n{f.read()}"
                except: continue
            
            # HANDLE VISUAL CONTEXT (Screenshots of UI bugs)
            elif HAS_PILLOW and file.endswith(('.png', '.jpg', '.jpeg', '.webp')):
                try:
                    img = PIL.Image.open(file_path)
                    message_parts.append(img)
                    print(f"--- SENTINEL: Attached image context: {file} ---")
                except: continue

    # THE CORE "UX ARCHITECT" PROMPT
    # This specifically addresses your "Day View" persistence bug.
    prompt = (
        "ACT AS: Senior Lead UX Architect. COMPARE: Codebase, Images, AND PLAN.md.\n\n"
        "SYSTEM PRIORITY: STATE PERSISTENCE.\n"
        "Issue: The 'Mobile Day View' (overlay) is incorrectly closing when an event is added.\n\n"
        "INSTRUCTIONS FOR ANALYSIS:\n"
        "1. Identify the event creation logic (likely in main.js).\n"
        "2. Ensure the overlay REMAINS VISIBLE after an event is saved/added.\n"
        "3. Look for calls like 'closeMobileDayView()' or full 'renderCalendar()' calls that trigger a reset.\n"
        "4. Replace destructive resets with partial updates (e.g., renderMobileDayOverlay()).\n\n"
        "OUTPUT MODES:\n"
        "- [PASS]: If all goals in PLAN.md are met and UX persistence is confirmed.\n"
        "- [ACTION]: If code changes are needed. Provide explicit line-item logic for Claude.\n"
        "- [MANUAL]: If a logical paradox or high-risk conflict is detected.\n\n"
        "BE SPECIFIC: Tell Claude exactly which function to modify to keep the overlay open."
    )

    message_parts.insert(0, prompt)
    message_parts.append(codebase_text)

    try:
        response = client.models.generate_content(
            model=MODEL_ID, 
            contents=message_parts
        )
        feedback = response.text
        
        # 1. HANDLE PASS
        if "[PASS]" in feedback.upper():
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write("System Verified: All tasks complete and UX persistence verified.")
            print("--- SENTINEL: Goal Reached. Loop Terminated. ---")
            sys.exit(0)

        # 2. HANDLE MANUAL STOP
        if "[MANUAL]" in feedback.upper():
            print("--- SENTINEL: Manual Intervention Required. Check AI_FEEDBACK.md. ---")
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write(f"# MANUAL INTERVENTION REQUIRED\n\n{feedback}")
            sys.exit(1) 

        # 3. HANDLE ACTION (Hand-off to Claude)
        with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
            f.write(f"# Sentinel Audit: Action Required\n\n{feedback}")

        print("--- SENTINEL: Blueprint updated for Claude. ---")
        sys.exit(0) 

    except Exception as e:
        print(f"SENTINEL Error: {str(e)}")
        sys.exit(0)

if __name__ == "__main__":
    run_analysis()