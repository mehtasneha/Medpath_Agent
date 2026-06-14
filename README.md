# 🩺 MedPath AI — Clinical Reasoning Assistant

## Overview
MedPath AI is an AI-powered clinical reasoning assistant built for the Microsoft AI Hackathon. It uses Azure AI Foundry (Phi-4 model) to analyze user-reported symptoms and generate structured, explainable medical reasoning including urgency classification, differential diagnosis, and recommended next steps.

The system is designed to simulate a transparent clinical decision-support pipeline, focusing on interpretability and structured reasoning rather than black-box responses.

---

## Problem
Users often struggle to understand the severity of symptoms or when to seek medical attention. This leads to:
- Delayed treatment
- Unnecessary panic
- Over-reliance on unverified online sources

There is a need for a structured, explainable AI-assisted triage system.

---

## Solution
MedPath AI addresses this by providing:
- Structured symptom collection
- AI-based reasoning using Azure AI Foundry (Phi-4)
- Urgency classification (Low / Moderate / High / Emergency)
- Differential diagnosis with confidence scoring
- Step-by-step reasoning explanation
- Clear, actionable recommendations

---

## System Architecture

User Input → React Frontend → Azure AI Foundry (Phi-4 Model) → Structured JSON Response → Validation Layer → Safety Rules Engine → UI Rendering → Report Generator

---

## Tech Stack

Frontend:
- React (Vite)
- Tailwind CSS
- JavaScript

AI Layer:
- Azure AI Foundry
- Phi-4 Model
- Prompt engineering with strict JSON schema
- Foundry IQ integration

Deployment:
- Vercel:https://medpath-agent-6bij.vercel.app/
- GitHub:https://github.com/mehtasneha/Medpath_Agent
- Youtube:https://youtu.be/Uv2GQUkGHFI

---

## Key Features
- AI-powered symptom analysis
- Real-time clinical reasoning visualization
- Medical urgency detection system
- Differential diagnosis with confidence scoring
- Explainable AI workflow
- Exportable report (PDF/HTML)
- Safety escalation for high-risk cases

---

## Environment Variables

Create a `.env` file in the root directory:

```bash
VITE_AZURE_FOUNDRY_KEY=your_api_key
VITE_AZURE_FOUNDRY_URL=your_endpoint_url
