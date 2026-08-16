# AI Investment Decision Support System (AIDSS)
## Master Blueprint v2.0 (Updated & Production-Ready)

> **Single Source of Truth** untuk pengembangan platform AI Investment Decision Support System pasar saham Indonesia.

---

### 📌 Ringkasan Pembaruan v2.0 (Changelog)
* **[NEW] OJK Legal & Compliance Framework:** Transisi dari rekomendasi mutlak "Beli/Jual" menjadi *Probability Score & Risk Profile Match* serta *Dynamic Disclaimer*.
* **[NEW] Stock Priority Tiering (Cost Efficiency):** Pembagian beban komputasi AI berbasis likuiditas saham (LQ45 = *Real-time*, Mid-Cap = *EOD*, Small-Cap = *On-Demand*).
* **[NEW] Multi-Currency & Scale Normalization Engine:** Penanganan otomatis untuk laporan keuangan emiten berdenominasi USD/IDR dan perbedaan skala unit.
* **[NEW] Post-2021 BEI Bandarmologi Adaptor:** Pemisahan pemrosesan *Real-Time Foreign Flow* dan *EOD Batch Broker Summary*.
* **[NEW] Deterministic Financial Guardrails:** Proteksi RAG/LLM dari halusinasi data keuangan melalui *fact-checking layer* berbasis database SQL.

---

# BAB 1. Executive Summary
- **Latar Belakang:** Tingginya kompleksitas dan dinamika pasar saham Indonesia (IHSG) memerlukan alat bantu keputusan investasi yang berbasis data, transparan, dan terukur.
- **Permasalahan:** Asimetri informasi, banyaknya rekomendasi *"black box"* yang tidak akurat, maraknya *saham gorengan*, serta risiko hukum analisa investasi tanpa izin resmi.
- **Tujuan:** Menjadi sistem pendukung keputusan investasi (*Decision Support System*) berbasis AI yang terpercaya, transparan, dan patuh terhadap regulasi pasar modal Indonesia.
- **Nilai Bisnis:** Mengurangi risiko kerugian investor ritel, memberikan rasionalisasi analitis terukur, dan mengoptimalkan portofolio investasi secara efisien.
- **Target Pengguna:** Investor ritel, swing trader, analis independen, dan wealth manager.
- **Competitive Advantage:** *Explainable AI* (SHAP), integrasi *Bandarmologi & Foreign Flow* spesifik BEI, serta arsitektur *Compliance-First*.

---

# BAB 2. Business Vision & Compliance
## Vision
Membangun platform AI Investment Decision Support System terdepan di Indonesia yang menggabungkan *Data Intelligence*, *Explainable AI*, dan *Compliance-First Architecture*.

## Misi
1. Mengintegrasikan seluruh data pasar saham Indonesia secara akurat dan *real-time*.
2. Menyediakan analisis berbasis AI tanpa memberikan nasihat keuangan ilegal (menggunakan *Probability Score*).
3. Menyajikan keterbukaan analisis melalui *Explainable AI* (SHAP).
4. Menjamin keakuratan data finansial melalui *Deterministic Guardrails*.

---

# BAB 3. Business Requirement & Legal Framework
## Modul Utama
- Authentication & User Profile Match
- Dashboard & Market Overview
- Stock Priority Tiering Manager
- Watchlist & Portfolio Intelligence
- AI Prediction & Probability Engine
- Explainable AI (SHAP Visualization)
- Financial Report RAG & Fact-Checking Engine
- Legal & Dynamic Disclaimer System
- Risk Engine & Anomaly Detector
- Alerts & Notification Center
- Administration & Compliance Monitoring

## Ketentuan Legal OJK (Compliance Rules)
- **No Absolute Buy/Sell Signal:** System dilarang keras memunculkan instruksi mutlak "Beli Saham X" atau "Jual Saham Y".
- **Probability & Risk Output:** Output diubah menjadi *Probability Score* (contoh: *"Probabilitas Kenaikan: 78%"*) yang dipasangkan dengan *Investor Risk Profile Match*.
- **Dynamic Legal Disclaimer:** Wajib menampilkan pop-up/banner *disclaimer* sebelum menampilkan analisis AI.

---

# BAB 4. System Requirement
## Functional Requirement (FR)
- **FR-AUTH:** Autentikasi aman berbasis OAuth 2.0, JWT, dan MFA.
- **FR-COMPLIANCE:** Sistem wajib melakukan pengecekan profil risiko pengguna sebelum menampilkan *Probability Score*.
- **FR-MARKET:** Sistem menyajikan data *real-time* untuk saham Tier 1 dan data *End-of-Day* untuk Tier 2/3.
- **FR-PREDICTION:** Menghasilkan skor probabilitas kenaikan/penurunan harga saham beserta faktor penentu (SHAP).
- **FR-PORTFOLIO:** Menghitung kinerja portofolio, *Sharpe Ratio*, *Max Drawdown*, dan alokasi aset.
- **FR-FACT-CHECK:** Sistem wajib menyaring seluruh keluaran teks RAG/LLM terhadap data numerik aktual di database.

## Non-Functional Requirement (NFR)
- **Performance:** Latensi respons WebSocket data harga < 200ms untuk saham Tier 1.
- **Security:** Enkripsi TLS 1.3 in-transit dan AES-256 at-rest.
- **Availability:** Uptime target 99.9% selama jam perdagangan bursa (08.30 - 16.00 WIB).
- **Scalability:** Mampu menangani hingga 50.000 concurrent user menggunakan arsitektur microservices.
- **Cost Efficiency:** Komputasi GPU/CPU diatur dinamis berbasis kriteria likuiditas saham.
- **Accuracy:** Toleransi kesalahan data numerik pada AI RAG = **0%**.

---

# BAB 5. Functional Modules
1. **Authentication & Risk Profiling Module:** Login OAuth/MFA + Kuisioner profil risiko investor.
2. **Dashboard & Market Overview:** Tampilan indeks IHSG, *Top Gainers/Losers*, dan *Foreign Flow Live*.
3. **Stock Detail & Priority Manager:** Menampilkan grafik interaktif (Lightweight Charts) disesuaikan dengan Tier saham.
4. **Technical Analysis Module:** Indikator otomatis (MA, RSI, MACD, Bollinger Bands, Volume Profile).
5. **Fundamental Analysis Module:** Rasio finansial, valuasi (DCF, PER Band), dan historis laporan keuangan.
6. **AI Probability Engine:** Menghitung skor probabilitas arah pergerakan harga berbasis LightGBM/TFT.
7. **Explainable AI (SHAP) Module:** Menerjemahkan bobot prediksi AI menjadi bahasa alami yang mudah dipahami.
8. **Financial Guardrail RAG Module:** Menggabungkan analisis teks laporan keuangan oleh LLM dengan *fact-checking* data SQL.
9. **Bandarmologi & Foreign Flow Engine:**
   - *Real-Time:* Foreign Flow (Net Foreign Buy/Sell saat jam bursa).
   - *EOD Batch:* Broker Summary Analysis (diolah setelah pkl 17.00 WIB).
10. **Risk & Anomaly Engine:** Deteksi manipulasi pasar (*saham gorengan*) menggunakan Isolation Forest & kalkulasi VaR via GARCH.
11. **Backtesting & Strategy Builder:** Pengujian strategi historis pengguna.
12. **Notification & Alert System:** Push notification berbasis WebSocket/SSE.
13. **Admin & Compliance Panel:** Audit trail terhadap seluruh rekomendasi AI yang tergenerasi.

---

# BAB 6. AI Architecture & Financial Guardrails

```
                           ┌───────────────────────────────┐
                           │      Data Ingestion Stream    │
                           └───────────────┬───────────────┘
                                           │
             ┌─────────────────────────────┴─────────────────────────────┐
             ▼                                                           ▼
┌───────────────────────────┐                               ┌───────────────────────────┐
│ Time-Series & Tabular ML  │                               │    RAG / LLM Text Engine  │
│ (LightGBM, XGBoost, TFT)  │                               │  (IndoBERT, GPT-4o/Claude)│
└────────────┬──────────────┘                               └────────────┬──────────────┘
             │                                                           │
             ▼                                                           ▼
┌───────────────────────────┐                               ┌───────────────────────────┐
│     SHAP Explainability   │                               │ Deterministic Fact-Check  │
│   (Faktor Pemicu Prediksi)│                               │ (Validation vs SQL DB)    │
└────────────┬──────────────┘                               └────────────┬──────────────┘
             │                                                           │
             └─────────────────────────────┬─────────────────────────────┘
                                           │
                                           ▼
                           ┌───────────────────────────────┐
                           │   AI Probability & Risk Score │
                           │       (OJK Compliant Output)  │
                           └───────────────────────────────┘
```

## Model Stack
- **Tabular / Technical / Bandarmologi:** LightGBM, XGBoost, CatBoost.
- **Time-Series Deep Learning (Tier 1):** Temporal Fusion Transformer (TFT) / GRU / LSTM.
- **Volatility & Risk:** GARCH Model.
- **Anomaly Detection:** Isolation Forest.
- **NLP & Sentiment:** IndoBERT (Berita lokal) + LLM via RAG (Laporan Keuangan).
- **Explainability:** SHAP (SHapley Additive exPlanations).

## Financial Guardrail Layer (Anti-Halusinasi LLM)
- LLM **hanya diizinkan** merangkum narasi (seperti *Management Discussion*, prospek usaha, dan sentimen berita).
- Semua angka finansial (Pendapatan, Laba Bersih, EPS, PER, PBV, Utang) wajib ditarik secara **deterministik dari database PostgreSQL**, bukan dari text generation LLM.

---

# BAB 7. Data Architecture & Ingestion
## Sumber Data
- **Market Data Real-Time:** GoAPI / IDX Direct Feed via WebSocket.
- **EOD Data:** Data historis OHLCV & Broker Summary (diolah EOD pkl 17.00 WIB).
- **Financial Statements:** Keterbukaan Informasi BEI / Web Scraping PDF.
- **News & Sentiment:** Portal berita finansial lokal (Bisnis.com, Kontan, CNBC Indonesia).
- **Macro Economy & Commodities:** Kurs USD/IDR, Suku Bunga BI, Harga Batu Bara, CPO, Nikel, Emas.

## Special Processing Engine
1. **Currency Normalization Engine:** Konversi otomatis laporan keuangan berdenominasi **USD** ke **IDR** menggunakan kurs JISDOR Bank Indonesia pada tanggal penutupan laporan keuangan.
2. **Scale Parser Engine:** Normalisasi otomatis satuan laporan keuangan (*Penuh*, *Ribuan*, *Jutaan*) ke standar baku IDR.
3. **Bandarmologi Splitter:** Pemisahan pemrosesan *Live Foreign Flow* dan *EOD Broker Accumulation*.

---

# BAB 8. Machine Learning Pipeline & Stock Priority Tiering
Sistem menerapkan **Stock Priority Tiering** untuk mengoptimalkan penggunaan GPU/Compute:

| Tier | Kriteria Saham | Cakupan Model AI | Frekuensi Update | Mode Komputasi |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | LQ45 & IDX30 (Sangat Likuid) | Full Ensemble (TFT + LightGBM + SHAP + Real-Time Foreign Flow + RAG LLM) | Real-Time (Tick-by-Tick / Minute) | Dedicated Compute / High Priority GPU |
| **Tier 2** | Kompas100 / Mid-Cap Likuid | LightGBM + XGBoost + Sentiment IndoBERT + EOD Bandarmologi | Hourly / End-of-Day (EOD) | Batch Processing CPU/GPU |
| **Tier 3** | Small-Cap / Saham Tidak Likuid | Basic Technical Rules + LightGBM EOD | On-Demand (Hanya aktif saat diakses user) | Serverless / On-Demand Trigger |

---

# BAB 9. Database Design (Entity Relationship Highlights)
Entitas utama dalam PostgreSQL + TimescaleDB:
- `users`: id, email, hashed_password, risk_profile_type, created_at.
- `roles`: id, name, permissions.
- `stocks`: ticker_symbol, company_name, **priority_tier** (Tier 1/2/3), sector, **reporting_currency** (IDR/USD).
- `stock_prices` (TimescaleDB hypertable): ticker, timestamp, open, high, low, close, volume, foreign_buy, foreign_sell.
- `financial_reports`: ticker, period, year, **original_currency**, **scale_factor**, revenue_raw, net_income_raw, **normalized_revenue_idr**, **normalized_net_income_idr**.
- `broker_summaries_eod`: ticker, date, top_3_buyer_volume, top_3_seller_volume, net_broker_accumulation.
- `news`: id, title, source_url, published_at, content, sentiment_score.
- `predictions`: ticker, generated_at, target_horizon, **upward_probability_score**, **risk_level**, **shap_explanation_json**.
- `models`: model_id, model_name, version, metrics_score, status.
- `alerts`: id, user_id, ticker, trigger_condition, is_active.
- `audit_logs`: timestamp, user_id, action, disclaimer_accepted_at.

---

# BAB 10. API Architecture
- **REST API (FastAPI - Python):** Mengelola autentikasi, fetching data historis, data fundamental, dan hasil analisis RAG.
- **WebSocket / SSE Server:** Menyiarkan data harga *real-time*, sinyal *live foreign flow*, dan *push alert*.
- **Authentication & Authorization:** OAuth 2.0, JWT, Role-Based Access Control (RBAC).
- **Rate Limiting & Gateway:** Redis-based rate limiter untuk mencegah *abuse* pada API.
- **Documentation:** Swagger / OpenAPI standar enterprise.

---

# BAB 11. Frontend Architecture (Mobile-First Web)
- **Framework:** Next.js (React) + TypeScript (PWA Enabled).
- **UI & Styling:** Tailwind CSS + Shadcn UI (Dark Mode Default).
- **Charting Engine:** Lightweight Charts by TradingView (performa tinggi di perangkat mobile).
- **State & Data Fetching:** TanStack Query + Zustand.
- **UX/UI Special Component:**
  - *Dynamic Legal Disclaimer Modal* sebelum akses fitur AI.
  - *Probability & Gauge Meter* (menggantikan grafik tombol "Beli/Jual").
  - *SHAP Waterfall Chart* untuk penjelasan transparan rekomendasi.

---

# BAB 12. Security & Compliance
- **Autentikasi & Otorisasi:** OAuth 2.0, MFA, JWT Token Rotation.
- **Enkripsi:** TLS 1.3 *in-transit* dan AES-256 *at-rest* untuk data pengguna.
- **OJK Compliance Enforcement:**
  - Pencatatan log persetujuan *disclaimer* pengguna ke tabel `audit_logs`.
  - *Fact-checker pipeline* untuk memutus risiko penyebaran hoaks/informasi keuangan yang salah.
- **Audit Trail & OWASP:** Kepatuhan OWASP Top 10 Security Risks.

---

# BAB 13. Infrastructure & DevOps
- **Containerization:** Docker & Kubernetes (K8s) untuk orchestrating microservices.
- **Database & Cache:** PostgreSQL (TimescaleDB) + Redis Cluster + Qdrant (Vector DB).
- **CI/CD Pipeline:** GitHub Actions untuk automated testing dan deployment.
- **Compute Management:** GPU Worker (NVIDIA) khusus dialokasikan secara efisien sesuai skema *Stock Priority Tiering*.
- **Storage:** Object Storage (S3-compatible) untuk laporan keuangan PDF & model artifacts.

---

# BAB 14. Monitoring, MLOps & Fact-Checking
- **Feature Store & Model Registry:** MLflow untuk mengelola versi dan deployment model.
- **Drift Detection:** Monitoring *Data Drift* dan *Concept Drift* pada model LightGBM/TFT menggunakan Evidently AI.
- **Hallucination Monitoring:** Pengecekan otomatis *Precision/Recall* pada jawaban RAG LLM.
- **Retraining Trigger:** Otomatisasi pemicu *retraining* saat performance metric turun di bawah ambang batas.

---

# BAB 15. Development Roadmap (Updated)

```
Phase 1: Business & Legal Foundation (Bulan 1)
├── Finalisasi OJK Compliance Framework & Dynamic Disclaimer
└── Setup Infrastruktur Basis (FastAPI, Next.js, Postgres)

Phase 2: Data Engineering & Normalization (Bulan 2)
├── Data Pipeline (GoAPI/IDX Data Feed)
├── Currency Normalization Engine (USD -> IDR)
└── Scale Parser & Post-2021 EOD Bandarmologi Splitter

Phase 3: AI & Stock Tiering Pipeline (Bulan 3-4)
├── Implementasi Stock Priority Tiering (Tier 1/2/3)
├── Training LightGBM + TFT + SHAP
└── Build Financial Guardrail Layer (Deterministic Fact-Checker)

Phase 4: Frontend Mobile-First & UI Integration (Bulan 5)
├── Integrasi Lightweight Charts & Gauge Meter
└── User Risk Profile Matcher

Phase 5: Security, Testing & Go-Live (Bulan 6)
├── Load Testing, Penetration Testing & AI Validation
└── Deployment Production & Continuous Monitoring
```

---

# BAB 16. Testing Strategy
- **Unit Testing:** Coverage minimal 85% untuk fungsi kalkulasi finansial & *Currency Normalizer*.
- **Integration Testing:** Pengujian API, WebSocket, dan antrean Redis.
- **Security Testing:** Vulnerability Scanning & Penetration Test.
- **Load Testing:** Pengujian kapasitas hingga 50.000 concurrent WebSocket connections.
- **AI & Backtesting Validation:** Pengujian akurasi prediksi model pada data historis IHSG 5 tahun terakhir.
- **Guardrail Testing:** Pengujian *stress-test* untuk memicu halusinasi LLM dan memastikan sistem berhasil memblokir data palsu.

---

# BAB 17. Deployment Strategy
- **Environment:** Development, Staging, dan Production.
- **Methodology:** *Blue/Green Deployment* untuk menjamin *zero downtime* saat *update* model AI.
- **Rollback Strategy:** Otomatisasi *fallback* ke versi model sebelumnya jika *drift metric* melebihi ambang batas toleransi.

---

# BAB 18. Future Enhancement
1. **Broker Trading Bridge / Webhooks:** Integrasi API langsung ke sekuritas untuk eksekusi transaksi yang diprakarsai pengguna.
2. **AI Copilot Agentic Mode:** Asisten interaktif berbasis suara/teks untuk simulasi portofolio.
3. **Multi-Market Expansion:** Ekspansi analisis ke pasar saham regional (US, SG, MY), Crypto, dan Forex.

---

# Prinsip Arsitektur
1. **Data Driven:** Seluruh keputusan berbasis analisis data objektif.
2. **Explainable AI:** Model AI transparan dan dapat dijelaskan (SHAP).
3. **Modular Architecture:** Setiap modul bersifat independen dan terisolasi.
4. **Enterprise Ready:** Siap menangani skala beban tinggi secara stabil.
5. **Security & Compliance by Design:** Patuh regulasi OJK dan standar keamanan siber sejak awal.
6. **MLOps First:** Pengelolaan siklus hidup model AI terotomatisasi secara komprehensif.
