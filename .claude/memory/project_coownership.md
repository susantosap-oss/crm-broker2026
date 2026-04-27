---
name: Listing Co-Ownership System
description: 1:N listing-agent system — Owner (first input) + Co-Owns via duplicate detection flow, LISTING_AGENTS junction table in Google Sheets
type: project
---

Implemented 2026-03-30. Fully deployed and operational.

**Key design decisions:**
- Owner = agent who first creates the listing (not exclusive — Co-Own can handle if Owner inactive)
- Co-Own status ONLY via duplicate detection flow ("Gabung ke Listing Ini") — no manual claim button
- Only Owner can edit listing; Co-Owns receive notifications on changes
- Principal role has "Ubah Owner" feature for inactive agent transfers
- Lead recorded to the agent the web visitor actually picks (not defaulting to Owner)

**Duplicate detection:** Weighted scoring — Alamat(40) + LT/LB(25) + Lokasi(15) + Harga(10) + KT(10), threshold 80pts, 3-step narrowing

**Junction table:** `LISTING_AGENTS` sheet — columns: ID, Listing_ID, Agen_ID, Agen_Nama, Role, Joined_At, Added_By, Notes

**Web behavior:**
- List cards: agent name removed
- Detail page: Owner (no.1) + Co-Owns shown without labels, user freely picks who to WA

**Why:** Agents from same brand sometimes list same property independently — co-ownership prevents duplicates while crediting all agents.
**How to apply:** Any listing changes affecting agent attribution must update both LISTING sheet and LISTING_AGENTS junction table.
