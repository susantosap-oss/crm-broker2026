---
name: CRM + Web Architecture
description: Dual-project setup — crm-broker2026 (Express backend + vanilla frontend) and web-mansion2026 (Next.js), both on GCP Cloud Run, Google Sheets as SSoT
type: project
---

Two separate GCP projects:

**crm-broker2026** (CRM)
- Express.js backend + vanilla HTML/JS frontend
- Google Sheets as SSoT (15+ tabs)
- Deployed to Cloud Run `asia-southeast1`
- URL: `https://crm-broker-properti-80037699510.asia-southeast1.run.app`

**web-mansion2026** (Website)
- Next.js (App Router), deployed to Cloud Run `asia-southeast2`
- URL: `https://web-mansion2026-177351947478.asia-southeast2.run.app`
- Reads Google Sheets via Google Apps Script (GAS) bridge — NOT directly from CRM backend
- GAS file: `gas/api-bridge.gs`

**Why:** Two separate deployments — CRM for internal agents, web for public-facing property listings.
**How to apply:** Changes to data layer may need updates in BOTH the CRM backend AND the GAS bridge script. GAS deploys require manual action in GAS editor (Deploy → New version).
