import os
import sys
import warnings
import google.generativeai as genai

warnings.filterwarnings("ignore")
genai.configure(api_key="AlzaSyCS_wq3-_O4tyP5L_mNkhmA4Nbh9_lc6kA")
model = genai.GenerativeModel('gemini-1.5-flash-latest')

IGNORE = {'.git', 'node_modules', '__pycache__', 'dist', 'AI_FEEDBACK.md', 'sentinel.py', '.env'}

def run_analysis():
    codebase = ""
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in IGNORE]
        for file in files:
            try:
                file_path = os.path.join(root, file)
                with open(file_path, 'r', encoding='utf-8') as f:
                    codebase += f"\n\n--- FILE: {file_path} ---\n{f.read()}"
            except: continue

    prompt = (
        "ACT AS: Senior Full-Stack Lead Architect.\n\n"
        "GOAL: Ensure the codebase matches PLAN.md with MINIMAL human intervention.\n\n"
        "ANALYSIS PIPELINE:\n"
        "1. VERIFICATION: Does the current code already satisfy the goals in PLAN.md? If yes, output [PASS].\n"
        "2. AUTONOMOUS PLANNING: If work is needed, can Claude do it using mocks, placeholders, or standard logic? If yes, output [ACTION] + steps.\n"
        "3. MANUAL ESCALATION: Only if a task requires a secret key, manual console toggle, or physical hardware access, output [MANUAL] + 'Reason'.\n\n"
        "PREFERENCE: Choose [ACTION] over [MANUAL] whenever a technical workaround exists."
    )

    try:
        response = model.generate_content([prompt, codebase])
        feedback = response.text
        
        # --- CASE 1: VERIFIED DONE ---
        if "[PASS]" in feedback.upper():
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write("System Verified: All tasks complete.")
            print("--- SENTINEL: System at Equilibrium. Loop Terminated. ---")
            sys.exit(0)

        # --- CASE 2: MANUAL INTERVENTION (THE BRAKE) ---
        if "[MANUAL]" in feedback.upper():
            print("--- SENTINEL: Manual Intervention Required. ---")
            # We don't update AI_FEEDBACK here so Claude doesn't try to guess
            sys.exit(1) 

        # --- CASE 3: ACTION REQUIRED (CLAUDE TAKES OVER) ---
        with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
            f.write(f"# Sentinel Audit: Action Required\n\n{feedback}")

        print("--- SENTINEL: New Plan Generated. Sending to Claude... ---")
        sys.exit(0) 

    except Exception as e:
        print(f"SENTINEL Error: {str(e)}")
        sys.exit(0)

if __name__ == "__main__":
    run_analysis()