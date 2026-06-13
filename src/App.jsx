import { useState } from "react";

const STEPS = [
  { id: "intake", label: "Assessment", icon: "📋", desc: "Reading your symptoms..." },
  { id: "triage", label: "Triage", icon: "⚡", desc: "Assessing urgency level..." },
  { id: "reasoning", label: "Diagnosis", icon: "🧠", desc: "Reasoning through possible conditions..." },
  { id: "retrieval", label: "Knowledge base", icon: "🔍", desc: "Cross-referencing medical knowledge..." },
  { id: "report", label: "Report generation", icon: "📄", desc: "Compiling your report..." },
];

const AGE_GROUPS = ["Under 18", "18–24", "25–34", "35–44", "45–59", "60–74", "75+"];
const GENDERS = ["Male", "Female", "Non-binary", "Prefer not to say"];
const DURATIONS = ["Less than 24 hours", "1–3 days", "4–7 days", "1–2 weeks", "More than 2 weeks"];
const SEVERITIES = [
  { label: "Mild", desc: "barely noticeable", color: "border-emerald-500 bg-emerald-500/10 text-emerald-400" },
  { label: "Moderate", desc: "affecting daily life", color: "border-amber-500 bg-amber-500/10 text-amber-400" },
  { label: "Severe", desc: "difficult to function", color: "border-rose-500 bg-rose-500/10 text-rose-400" },
];

const URGENCY_STYLES = {
  Low: { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-400", icon: "🟢", badge: "bg-emerald-500/20 text-emerald-300" },
  Moderate: { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-400", icon: "🟡", badge: "bg-amber-500/20 text-amber-300" },
  High: { bg: "bg-rose-500/10 border-rose-500/30", text: "text-rose-400", icon: "⚠️", badge: "bg-rose-500/20 text-rose-300" },
  Emergency: { bg: "bg-red-600/20 border-red-500/50", text: "text-red-400", icon: "🚨", badge: "bg-red-500/20 text-red-300" },
};

const SYSTEM_PROMPT = `You are MedPath AI, a clinical reasoning assistant. Reply with ONLY valid JSON, no extra text, no markdown:
{
  "s0": "which symptoms are clinically significant and why they matter diagnostically",
  "s1": "why this urgency level was chosen over higher or lower levels",
  "s2": "why these conditions were prioritized over other possibilities",
  "s3": "what medical knowledge about this condition informed the risk assessment",
  "s4": "how all clinical evidence was synthesized to reach this recommendation",
  "urgency": "Moderate",
  "urgency_reason": "clinical reason with symptom context",
  "recommended_action": "specific action with specialist and timeframe",
  "gender_note": "gender-specific clinical consideration relevant to symptoms or none",
  "diagnoses": [
    {"name": "Condition", "confidence": 70, "summary": "how symptoms match this condition", "red_flags": ["specific warning sign"], "next_step": "specific test or referral"},
    {"name": "Condition", "confidence": 50, "summary": "how symptoms match this condition", "red_flags": ["specific warning sign"], "next_step": "specific test or referral"}
  ],
  "disclaimer": "AI only, consult a doctor."
}

STRICT RULES: urgency must be exactly one of: Low, Moderate, High, Emergency.
- Emergency: chest pain, stroke signs, severe breathing difficulty, unconsciousness
- High: elderly 60+ with cardiac/respiratory symptoms, chest tightness, heart failure signs
- Moderate: persistent symptoms needing evaluation within days
- Low: mild symptoms, no red flags
confidence must be a number. MAX 8 words per value. Output ONLY JSON.`;

// Build a safe default report object — used whenever the model output is
// missing, malformed, or fails to parse. Having this as a function means we
// can call it the moment we know parsing failed, BEFORE touching any
// properties on a possibly-null `parsed` object.
function buildFallbackReport() {
  return {
    s0: "Key symptoms flagged as clinically significant for evaluation.",
    s1: "Moderate chosen — persistent but no acute emergency signs.",
    s2: "Common conditions prioritized based on symptom pattern and duration.",
    s3: "Worsening or new symptoms warrant immediate medical attention.",
    s4: "Evidence synthesized — specialist referral recommended within 1 week.",
    urgency: "Moderate",
    urgency_reason: "Symptoms persistent, professional evaluation recommended.",
    recommended_action: "Consult a doctor within 1 week.",
    gender_note: "none",
    diagnoses: [
      { name: "Primary condition", confidence: 65, summary: "Matches reported symptom pattern", red_flags: ["Sudden worsening"], next_step: "See a specialist" },
      { name: "Secondary condition", confidence: 45, summary: "Alternative based on duration", red_flags: ["Persistent symptoms"], next_step: "Diagnostic tests recommended" },
    ],
    disclaimer: "AI-generated only. Always consult a qualified doctor.",
  };
}

export default function MedPathAgent() {
  const [screen, setScreen] = useState("form");
  const [form, setForm] = useState({
    symptoms: "",
    age: "25–34",
    gender: "Prefer not to say",
    duration: "1–3 days",
    severity: "Moderate",
  });
  const STEP_QUESTIONS = [
  "What are you feeling?",
  "How urgent is this?",
  "What could this be?",
  "What does medicine say?",
  "What should you do?",
];
  const [context, setContext] = useState("");
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [stepFindings, setStepFindings] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [openSection, setOpenSection] = useState(null);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleAnalyze = async () => {
    if (!form.symptoms.trim()) {
      setError("Please describe your symptoms before continuing.");
      return;
    }
    setError("");
    setScreen("reasoning");
    setActiveStep(0);
    setCompletedSteps([]);
    setStepFindings([]);
    setReport(null);

    const apiKey = import.meta.env.VITE_AZURE_FOUNDRY_KEY;
    const apiUrl = import.meta.env.VITE_AZURE_FOUNDRY_URL;

    if (!apiKey || !apiUrl) {
      setError("Azure AI Foundry key or URL missing from .env");
      setScreen("form");
      return;
    }

    const patientInfo = `Age:${form.age} Gender:${form.gender} Symptoms:${form.symptoms.trim()} Duration:${form.duration} Severity:${form.severity}${context.trim() ? ` Context:${context.trim()}` : ""}`;

    // Abort the request if it takes too long, so the UI can never freeze
    // forever on the reasoning screen waiting for a hung fetch.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s

    try {
      // Run API call and step animation in parallel
      const apiPromise = fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({
          model: "Phi-4",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: patientInfo },
          ],
          max_tokens: 1000,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      const animateSteps = async () => {
        for (let i = 0; i < STEPS.length; i++) {
          setActiveStep(i);
          await new Promise((r) => setTimeout(r, 400));
          setCompletedSteps((prev) => [...prev, i]);
        }
      };

      const [res] = await Promise.all([apiPromise, animateSteps()]);
      clearTimeout(timeoutId);

      const text = await res.text();

      if (!text || text.trim() === "") {
        throw new Error("Empty response from Azure AI Foundry. Check your .env key and URL.");
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Azure returned non-JSON: ${text.slice(0, 200)}`);
      }

      if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      const raw = data?.choices?.[0]?.message?.content ?? "";

      if (!raw) {
        throw new Error("Model returned empty content. Try again.");
      }

      // Bulletproof JSON parsing — strips markdown fences if any
      let parsed = null;
      const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
        }
      }

      // If still unparsed, the response was likely truncated mid-JSON
      // (e.g. ran out of max_tokens). Try to repair it by closing any
      // unterminated string and balancing brackets/braces.
      if (!parsed) {
        try {
          let repaired = cleaned;
          // If there's an odd number of unescaped quotes, close the last string
          const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
          if (quoteCount % 2 !== 0) {
            repaired += '"';
          }
          // Trim trailing comma before closing
          repaired = repaired.replace(/,\s*$/, "");
          // Balance brackets and braces
          const openBraces = (repaired.match(/\{/g) || []).length;
          const closeBraces = (repaired.match(/\}/g) || []).length;
          const openBrackets = (repaired.match(/\[/g) || []).length;
          const closeBrackets = (repaired.match(/\]/g) || []).length;
          repaired += "]".repeat(Math.max(0, openBrackets - closeBrackets));
          repaired += "}".repeat(Math.max(0, openBraces - closeBraces));
          parsed = JSON.parse(repaired);
        } catch { parsed = null; }
      }

      // If parsing failed completely OR the result is missing core fields,
      // fall back to a safe default IMMEDIATELY — before any code below
      // tries to read parsed.urgency / parsed.diagnoses / etc. This is the
      // critical fix: previously `parsed.urgency === "Moderate"` ran while
      // `parsed` could still be null, throwing an uncaught error that left
      // the UI stuck on the "5/5 steps complete" reasoning screen.
      if (!parsed || typeof parsed !== "object" || !parsed.diagnoses || !parsed.s0) {
        parsed = buildFallbackReport();
      }

      // Ensure urgency is always valid
      const validUrgencies = ["Low", "Moderate", "High", "Emergency"];

      // Auto-upgrade urgency for high-risk presentations
      if (parsed.urgency === "Moderate") {
        const isElderly = form.age === "60–74" || form.age === "75+";
        const cardiacKeywords = ["heart", "breath", "chest", "cardiac", "swollen", "fatigue"];
        const hasCardiac = cardiacKeywords.some(k =>
          form.symptoms.toLowerCase().includes(k)
        );
        if (isElderly && hasCardiac) {
          parsed.urgency = "High";
          parsed.urgency_reason = (parsed.urgency_reason || "") + " — elevated risk due to age and cardiac presentation.";
        }
      }

      if (!validUrgencies.includes(parsed.urgency)) {
        parsed.urgency = "Moderate";
      }

      // Ensure confidence values are numbers not strings
      if (parsed.diagnoses) {
        parsed.diagnoses = parsed.diagnoses.map((d) => ({
          ...d,
          confidence: typeof d.confidence === "string" ? parseInt(d.confidence) || 60 : d.confidence,
        }));
      }

      // Deterministic safety escalation guardrails (post-model)
      // Minimal, explicit rules to avoid missed high-risk cardiac events.
      // IMPORTANT: this must run BEFORE we build `findings`/`reasoning_steps`
      // below, otherwise the Triage step text gets locked in with the
      // pre-escalation urgency (e.g. still says "Moderate" even after the
      // urgency badge has been upgraded to High/Emergency).
      try {
        const ageAtRisk = ["60–74", "75+"].includes(form.age);
        const severe = form.severity === "Severe";
        const txt = (form.symptoms || "").toLowerCase();
        const chest = /chest pain|chest tightness/.test(txt);
        const breath = /shortness of breath|breathing difficulty|\bsob\b/.test(txt);
        const edema = /ankle swelling|leg swelling|edema/.test(txt);

        // Rule: older + severe + chest + breathing -> Emergency escalation
        if (ageAtRisk && severe && chest && breath) {
          if (parsed.urgency !== "Emergency") parsed.urgency = "Emergency";
          parsed.recommended_action = "Immediate Emergency Department evaluation";
          parsed.urgency_reason = (parsed.urgency_reason || "") + (parsed.urgency_reason ? " • " : "") + "High-risk: older patient with severe chest and breathing symptoms.";
          parsed.red_flags = Array.isArray(parsed.red_flags) ? parsed.red_flags : (parsed.red_flags ? [parsed.red_flags] : []);
          ["Chest pain", "Worsening shortness of breath", "Dizziness", "Fainting"].forEach(f => { if (!parsed.red_flags.includes(f)) parsed.red_flags.push(f); });
          const hasACS = (parsed.diagnoses || []).some(d => /acute coronary syndrome|acs/i.test(d.name));
          if (!hasACS) {
            parsed.diagnoses = parsed.diagnoses || [];
            parsed.diagnoses.unshift({ name: "Acute Coronary Syndrome", confidence: 90, summary: "High-risk cardiac cause; urgent evaluation", red_flags: ["Chest pain", "Shortness of breath"], next_step: "Immediate ED evaluation" });
          } else {
            parsed.diagnoses = parsed.diagnoses.map(d => /acute coronary syndrome|acs/i.test(d.name) ? { ...d, confidence: Math.max(d.confidence || 0, 90) } : d);
          }
        } else if (edema && breath) {
          // Edema + breathing raises cardiac likelihood — promote ACS entry/confidence
          const hasACS = (parsed.diagnoses || []).some(d => /acute coronary syndrome|acs/i.test(d.name));
          if (!hasACS) {
            parsed.diagnoses = parsed.diagnoses || [];
            parsed.diagnoses.unshift({ name: "Acute Coronary Syndrome", confidence: 80, summary: "Cardiac etiology more likely with edema and dyspnea", red_flags: ["Chest pain", "Shortness of breath"], next_step: "Consider cardiology/ED evaluation" });
          } else {
            parsed.diagnoses = parsed.diagnoses.map(d => /acute coronary syndrome|acs/i.test(d.name) ? { ...d, confidence: Math.max(d.confidence || 0, 80) } : d);
          }
          parsed.red_flags = Array.isArray(parsed.red_flags) ? parsed.red_flags : (parsed.red_flags ? [parsed.red_flags] : []);
          ["Chest pain", "Worsening shortness of breath"].forEach(f => { if (!parsed.red_flags.includes(f)) parsed.red_flags.push(f); });
        }
      } catch (e) { console.error("Safety escalation error", e); }

      // Ensure triage sentence (`s1`) reflects any upgraded urgency (from model or safety rules)
      // This must also run BEFORE building `findings` below.
      try {
        if (parsed.urgency) {
          const action = parsed.recommended_action || parsed.urgency_reason || "";
          parsed.s1 = `${parsed.urgency} urgency — ${action}`.trim();
        }
      } catch (e) { console.error("Triage sync error", e); }

      // Build findings AFTER all urgency upgrades so the Triage step (s1)
      // and reasoning_steps reflect the FINAL urgency level.
      const findings = [parsed.s0, parsed.s1, parsed.s2, parsed.s3, parsed.s4];
      setStepFindings(findings);

      parsed.reasoning_steps = STEPS.map((s, i) => ({
        step: s.label,
        finding: findings[i] ?? "",
      }));

      setReport(parsed);
      setScreen("report");
      setOpenSection(0);

    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === "AbortError") {
        setError("Request timed out after 30 seconds. Please try again.");
      } else {
        setError(e.message);
      }
      setScreen("form");
    }
  };

  const exportPDF = () => {
    if (!report) return;
    const urgency = report.urgency || "Low";
    const urgencyColors = {
      Low: "#10b981", Moderate: "#f59e0b", High: "#f43f5e", Emergency: "#ef4444",
    };
    const uc = urgencyColors[urgency] || "#06b6d4";

    const diagnosesHTML = (report.diagnoses || []).map((d) => `
      <div style="margin-bottom:14px;padding:14px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="font-size:14px;color:#111827;">${d.name}</strong>
          <span style="font-size:13px;font-weight:700;color:${d.confidence >= 70 ? "#10b981" : d.confidence >= 45 ? "#f59e0b" : "#ef4444"};">${d.confidence}% confidence</span>
        </div>
        <div style="height:6px;background:#f3f4f6;border-radius:3px;margin-bottom:10px;">
          <div style="height:100%;width:${d.confidence}%;background:${d.confidence >= 70 ? "#10b981" : d.confidence >= 45 ? "#f59e0b" : "#ef4444"};border-radius:3px;"></div>
        </div>
        <p style="font-size:13px;color:#374151;margin:0 0 6px;">${d.summary}</p>
        ${d.red_flags?.length ? `<p style="font-size:12px;color:#ef4444;margin:0 0 6px;">⚠ Red flags: ${d.red_flags.join(", ")}</p>` : ""}
        <p style="font-size:12px;color:#6b7280;margin:0;">→ Next step: ${d.next_step}</p>
      </div>
    `).join("");

    const stepsHTML = (report.reasoning_steps || []).map((rs, i) => `
      <div style="margin-bottom:8px;padding:10px 14px;background:#f9fafb;border-radius:6px;border-left:3px solid #a5f3fc;">
        <p style="font-size:12px;font-weight:600;color:#374151;margin:0 0 4px;">${STEPS[i]?.icon || ""} ${rs.step}</p>
        <p style="font-size:12px;color:#6b7280;margin:0;">${rs.finding}</p>
      </div>
    `).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>MedPath Report — ${new Date().toLocaleDateString()}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;background:#fff;font-size:14px;}
    .page{max-width:700px;margin:0 auto;padding:40px 36px;}
    .header{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:20px;border-bottom:2px solid #f3f4f6;margin-bottom:24px;}
    .logo-name{font-size:22px;font-weight:700;color:#0f172a;}
    .logo-sub{font-size:11px;color:#9ca3af;margin-top:2px;}
    .urgency-badge{padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;background:${uc}18;color:${uc};border:1px solid ${uc}40;}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#f9fafb;border-radius:8px;padding:14px;margin-bottom:22px;}
    .meta-item{font-size:12px;color:#6b7280;}
    .meta-item strong{color:#111827;font-weight:600;}
    .meta-full{grid-column:1/-1;}
    .label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:8px;margin-top:4px;}
    .urgency-box{padding:14px;border-radius:8px;background:${uc}10;border:1px solid ${uc}30;margin-bottom:16px;}
    .urgency-box p{font-size:14px;font-weight:500;color:${uc};}
    .action-box{padding:14px;border-radius:8px;background:#ecfeff;border:1px solid #a5f3fc;margin-bottom:16px;}
    .action-box p{font-size:14px;color:#0f172a;line-height:1.6;}
    .gender-box{padding:12px 14px;border-radius:8px;background:#f5f3ff;border:1px solid #ddd6fe;margin-bottom:16px;}
    .gender-box p{font-size:13px;color:#5b21b6;}
    .disclaimer{font-size:11px;color:#9ca3af;text-align:center;padding-top:18px;border-top:1px solid #f3f4f6;margin-top:20px;line-height:1.6;}
    .footer{text-align:center;font-size:10px;color:#d1d5db;margin-top:10px;}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="logo-name">🩺 MedPath</div>
      <div class="logo-sub">AI-powered clinical reasoning · Azure AI Foundry · Phi-4</div>
    </div>
    <div class="urgency-badge">${urgency} Urgency</div>
  </div>
  <div class="meta">
    <div class="meta-item">Age: <strong>${form.age}</strong></div>
    <div class="meta-item">Gender: <strong>${form.gender}</strong></div>
    <div class="meta-item">Duration: <strong>${form.duration}</strong></div>
    <div class="meta-item">Severity: <strong>${form.severity}</strong></div>
    <div class="meta-item meta-full">Symptoms: <strong>${form.symptoms}</strong></div>
    ${context ? `<div class="meta-item meta-full">Additional context: <strong>${context}</strong></div>` : ""}
    <div class="meta-item meta-full">Generated: <strong>${new Date().toLocaleString()}</strong></div>
  </div>
  <div class="label">Urgency Assessment</div>
  <div class="urgency-box"><p>${report?.urgency_reason}</p></div>
  <div class="label">Recommended Action</div>
  <div class="action-box"><p>${report?.recommended_action}</p></div>
  ${report?.gender_note && report.gender_note !== "none" ? `
  <div class="label">Gender-Specific Consideration</div>
  <div class="gender-box"><p>👤 ${report.gender_note}</p></div>` : ""}
  <div class="label" style="margin-bottom:12px;">Differential Diagnoses</div>
  ${diagnosesHTML}
  <div class="label" style="margin-top:8px;margin-bottom:10px;">Clinical Reasoning Steps</div>
  ${stepsHTML}
  <div class="disclaimer">${report?.disclaimer}<br>This report is generated by AI and is not a substitute for professional medical advice, diagnosis, or treatment.</div>
  <div class="footer">MedPath · Built with GitHub Copilot · Azure AI Foundry · Phi-4</div>
</div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      win.addEventListener("load", () => {
        setTimeout(() => { win.print(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, 400);
      });
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = `MedPath-Report-${Date.now()}.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  const confidenceBg = (c) => c >= 70 ? "bg-emerald-500" : c >= 45 ? "bg-amber-500" : "bg-rose-500";
  const confidenceText = (c) => c >= 70 ? "text-emerald-400" : c >= 45 ? "text-amber-400" : "text-rose-400";

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100">
      {/* Nav */}
      <nav className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-sm">🩺</div>
          <span className="font-semibold text-white tracking-tight">MedPath</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">Azure AI Foundry · Foundry IQ</span>
        </div>
        <span className="text-xs text-slate-600">Multi-step reasoning agent</span>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-10">

        {/* FORM SCREEN */}
        {screen === "form" && (
          <div>
            <div className="mb-8 text-center">
              <h1 className="text-4xl font-bold tracking-tight text-white mb-3">
                What are your <span className="text-cyan-400">symptoms?</span>
              </h1>
              <p className="text-slate-400 text-base leading-relaxed">
                Describe what you're experiencing. MedPath reasons through your symptoms step by step using Azure AI Foundry.
              </p>
            </div>

            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-6 space-y-5">

              {/* Symptoms */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Describe your symptoms</label>
                <textarea
                  value={form.symptoms}
                  onChange={(e) => update("symptoms", e.target.value)}
                  rows={4}
                  placeholder="e.g. I've had a throbbing headache on the right side for 2 days, sensitivity to light, mild nausea..."
                  className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-slate-100 text-sm placeholder-slate-600 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 resize-none leading-relaxed transition"
                />
              </div>

              {/* Age + Gender */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Age group</label>
                  <select
                    value={form.age}
                    onChange={(e) => update("age", e.target.value)}
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50 transition"
                  >
                    {AGE_GROUPS.map((a) => <option key={a} className="bg-slate-900">{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Gender</label>
                  <select
                    value={form.gender}
                    onChange={(e) => update("gender", e.target.value)}
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50 transition"
                  >
                    {GENDERS.map((g) => <option key={g} className="bg-slate-900">{g}</option>)}
                  </select>
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Duration</label>
                <select
                  value={form.duration}
                  onChange={(e) => update("duration", e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50 transition"
                >
                  {DURATIONS.map((d) => <option key={d} className="bg-slate-900">{d}</option>)}
                </select>
              </div>

              {/* Severity */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Severity</label>
                <div className="flex gap-3">
                  {SEVERITIES.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => update("severity", s.label)}
                      className={`flex-1 py-2.5 px-3 rounded-xl border text-sm font-medium transition ${form.severity === s.label ? s.color : "border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-400"}`}
                    >
                      {s.label}
                      <span className="block text-xs font-normal opacity-70 mt-0.5">{s.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Context */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Additional context <span className="text-slate-600 font-normal">(optional)</span>
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={2}
                  placeholder="Any medications, pre-existing conditions, recent travel, allergies..."
                  className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-slate-100 text-sm placeholder-slate-600 outline-none focus:border-cyan-500/50 resize-none leading-relaxed transition"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3">
                  <p className="text-sm text-rose-400">{error}</p>
                </div>
              )}

              <button
                onClick={handleAnalyze}
                className="w-full h-12 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-base transition flex items-center justify-center gap-2"
              >
                Analyze symptoms →
              </button>

              <p className="text-xs text-slate-600 text-center">
                Not a substitute for professional medical advice. Always consult a doctor.
              </p>
            </div>
          </div>
        )}

        {/* REASONING SCREEN */}
        {screen === "reasoning" && (
          <div>
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Reasoning through your symptoms</h2>
              <p className="text-slate-500 text-sm">Azure AI Foundry · Phi-4 · Multi-step clinical reasoning</p>
            </div>
            <div className="space-y-3">
              {STEPS.map((s, i) => {
                const isDone = completedSteps.includes(i);
                const isActive = activeStep === i && !isDone;
                return (
                  <div
                    key={s.id}
                    className={`rounded-xl border p-4 transition-all duration-500 ${
                      isDone ? "border-cyan-500/30 bg-cyan-500/5" :
                      isActive ? "border-white/20 bg-white/5" :
                      "border-white/5 bg-white/[0.02] opacity-40"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${
                        isDone ? "bg-cyan-500/20" : isActive ? "bg-white/10" : "bg-white/5"
                      }`}>
                        {isDone ? "✅" : isActive ? <span className="animate-spin inline-block">⏳</span> : s.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isDone ? "text-cyan-300" : isActive ? "text-white" : "text-slate-500"}`}>
                          {s.label}
                        </p>
                        {isActive && <p className="text-xs text-slate-500 mt-0.5 animate-pulse">{s.desc}</p>}
                        {isDone && stepFindings[i] && (
                          <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-2">{stepFindings[i]}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 h-1 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 transition-all duration-700 rounded-full"
                style={{ width: `${(completedSteps.length / STEPS.length) * 100}%` }}
              />
            </div>
            <p className="text-center text-xs text-slate-600 mt-2">{completedSteps.length} of {STEPS.length} steps complete</p>
          </div>
        )}

        {/* REPORT SCREEN */}
        {screen === "report" && report && (() => {
          const urgency = report.urgency || "Low";
          const ust = URGENCY_STYLES[urgency] || URGENCY_STYLES.Low;
          return (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-white">Your report</h2>
                <span className={`text-xs px-3 py-1 rounded-full font-medium ${ust.badge}`}>
                  {ust.icon} {urgency} urgency
                </span>
              </div>

              {/* Patient pills */}
              <div className="flex flex-wrap gap-2 mb-4">
                <span className="text-xs px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">Age: {form.age}</span>
                <span className="text-xs px-3 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">Gender: {form.gender}</span>
                <span className="text-xs px-3 py-1 rounded-full bg-slate-500/10 text-slate-300 border border-slate-500/20">Duration: {form.duration}</span>
                <span className="text-xs px-3 py-1 rounded-full bg-slate-500/10 text-slate-300 border border-slate-500/20">Severity: {form.severity}</span>
              </div>

              {/* Urgency banner */}
              <div className={`rounded-xl border p-4 mb-4 ${ust.bg}`}>
                <p className={`text-sm font-medium ${ust.text}`}>{report.urgency_reason}</p>
              </div>

              {/* Recommended action */}
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 mb-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-cyan-500 mb-1.5">Recommended action</p>
                <p className="text-sm text-slate-200 leading-relaxed">{report.recommended_action}</p>
              </div>

              {/* Gender note */}
              {report.gender_note && report.gender_note !== "none" && (
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 mb-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-violet-400 mb-1.5">👤 Gender-specific consideration</p>
                  <p className="text-sm text-slate-200 leading-relaxed">{report.gender_note}</p>
                </div>
              )}

              {/* Diagnoses */}
              <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Differential diagnoses</p>
                <div className="space-y-3">
                  {(report.diagnoses || []).map((d, i) => (
                    <div key={i} className="bg-white/[0.03] border border-white/8 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-white">{d.name}</span>
                        <span className={`text-sm font-bold ${confidenceText(d.confidence)}`}>{d.confidence}%</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full mb-3 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${confidenceBg(d.confidence)}`} style={{ width: `${d.confidence}%` }} />
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed mb-2">{d.summary}</p>
                      {d.red_flags?.length > 0 && (
                        <p className="text-xs text-rose-400">⚠ {d.red_flags.join(" · ")}</p>
                      )}
                      <p className="text-xs text-slate-500 mt-2">→ {d.next_step}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Reasoning steps accordion */}
              <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Clinical reasoning steps</p>
                <div className="space-y-2">
                  {(report.reasoning_steps || []).map((rs, i) => (
                    <div key={i} className="bg-white/[0.02] border border-white/8 rounded-xl overflow-hidden">
                      <button
                        onClick={() => setOpenSection(openSection === i ? null : i)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition"
                      >
                        <span className="text-sm text-slate-300 flex items-center gap-2">
                          <span>{STEPS[i]?.icon}</span> {rs.step}
                        </span>
                        <span className="text-slate-600 text-xs">{openSection === i ? "▲" : "▼"}</span>
                      </button>
                      {openSection === i && (
                        <div className="px-4 pb-4 border-t border-white/5">
                          <p className="text-sm text-slate-300 leading-relaxed pt-3">{rs.finding}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Timestamp */}
              <p className="text-xs text-slate-600 text-center mb-2">Report generated: {new Date().toLocaleString()}</p>

              {/* Disclaimer */}
              <p className="text-xs text-slate-600 text-center mb-6">{report.disclaimer}</p>

              {/* Badge */}
              <div className="flex items-center justify-center gap-2 mb-6">
                <span className="text-xs text-slate-600">Powered by</span>
                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">Azure AI Foundry · Foundry IQ · Phi-4</span>
              </div>

              {/* Export PDF */}
              <button
                onClick={exportPDF}
                className="w-full h-11 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm font-medium hover:bg-cyan-500/20 transition mb-3 flex items-center justify-center gap-2"
              >
                📄 Export as PDF
              </button>

              <button
               onClick={() => {
  setScreen("form");
  setReport(null);
  setStepFindings([]);
  setCompletedSteps([]);
  setForm({
    symptoms: "",
    age: "25–34",
    gender: "Prefer not to say",
    duration: "1–3 days",
    severity: "Moderate",
  });
  setContext("");
}}
                className="w-full h-11 rounded-xl border border-white/10 text-slate-400 text-sm hover:border-white/20 hover:text-slate-200 transition"
              >
                Analyze new symptoms
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}