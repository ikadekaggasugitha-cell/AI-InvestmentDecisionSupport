/* Indonesian Stock Exchange (IDX) — baseline data, mid-2026 */

/* tier: 1=LQ45/IDX30 (real-time), 2=Kompas100/mid-cap (EOD), 3=small-cap (on-demand) */
export const IDX_STOCKS = [
  { symbol: "BBCA",  name: "Bank Central Asia",       sector: "Keuangan",        sectorEn: "Financials",     basePrice: 9850,  lotSize: 100, vol: 0.012, drift:  0.00010, mktCap: "1.212T", pe: 21.4, tier: 1 as const },
  { symbol: "BBRI",  name: "Bank Rakyat Indonesia",   sector: "Keuangan",        sectorEn: "Financials",     basePrice: 4310,  lotSize: 100, vol: 0.015, drift:  0.00008, mktCap: "664B",   pe: 13.8, tier: 1 as const },
  { symbol: "TLKM",  name: "Telkom Indonesia",        sector: "Telekomunikasi",  sectorEn: "Telecom",        basePrice: 2940,  lotSize: 100, vol: 0.013, drift: -0.00005, mktCap: "291B",   pe: 17.2, tier: 1 as const },
  { symbol: "ASII",  name: "Astra International",     sector: "Konglomerasi",    sectorEn: "Conglomerate",   basePrice: 4720,  lotSize: 100, vol: 0.014, drift:  0.00006, mktCap: "191B",   pe: 11.3, tier: 1 as const },
  { symbol: "GOTO",  name: "GoTo Gojek Tokopedia",    sector: "Teknologi",       sectorEn: "Technology",     basePrice: 68,    lotSize: 100, vol: 0.025, drift: -0.00005, mktCap: "73B",    pe: null, tier: 1 as const },
  { symbol: "BREN",  name: "Barito Renewables Energy",sector: "Energi",          sectorEn: "Energy",         basePrice: 8450,  lotSize: 100, vol: 0.018, drift:  0.00012, mktCap: "208B",   pe: 48.2, tier: 1 as const },
  { symbol: "ADRO",  name: "Adaro Energy Indonesia",  sector: "Energi",          sectorEn: "Energy",         basePrice: 2520,  lotSize: 100, vol: 0.016, drift:  0.00010, mktCap: "80B",    pe: 7.8,  tier: 1 as const },
  { symbol: "BMRI",  name: "Bank Mandiri",            sector: "Keuangan",        sectorEn: "Financials",     basePrice: 5800,  lotSize: 100, vol: 0.013, drift:  0.00009, mktCap: "538B",   pe: 12.1, tier: 1 as const },
  { symbol: "UNVR",  name: "Unilever Indonesia",      sector: "Konsumer",        sectorEn: "Consumer",       basePrice: 3080,  lotSize: 100, vol: 0.011, drift:  0.00003, mktCap: "117B",   pe: 23.5, tier: 2 as const },
  { symbol: "ICBP",  name: "Indofood CBP Sukses",     sector: "Konsumer",        sectorEn: "Consumer",       basePrice: 9625,  lotSize: 100, vol: 0.010, drift:  0.00007, mktCap: "112B",   pe: 18.9, tier: 2 as const },
  { symbol: "ANTM",  name: "Aneka Tambang",           sector: "Material",        sectorEn: "Materials",      basePrice: 1870,  lotSize: 100, vol: 0.022, drift:  0.00015, mktCap: "44B",    pe: 14.6, tier: 2 as const },
  { symbol: "PTBA",  name: "Bukit Asam",              sector: "Energi",          sectorEn: "Energy",         basePrice: 2840,  lotSize: 100, vol: 0.017, drift:  0.00010, mktCap: "32B",    pe: 6.4,  tier: 2 as const },
  { symbol: "KLBF",  name: "Kalbe Farma",             sector: "Kesehatan",       sectorEn: "Healthcare",     basePrice: 1620,  lotSize: 100, vol: 0.012, drift:  0.00006, mktCap: "76B",    pe: 22.1, tier: 2 as const },
  { symbol: "SMGR",  name: "Semen Indonesia",         sector: "Material",        sectorEn: "Materials",      basePrice: 4180,  lotSize: 100, vol: 0.015, drift:  0.00004, mktCap: "25B",    pe: 15.3, tier: 3 as const },
  { symbol: "EMTK",  name: "Elang Mahkota Teknologi", sector: "Telekomunikasi",  sectorEn: "Telecom",        basePrice: 860,   lotSize: 100, vol: 0.019, drift:  0.00003, mktCap: "19B",    pe: null, tier: 3 as const },
] as const;

export type StockSymbol = typeof IDX_STOCKS[number]["symbol"];

/* Portfolio holdings — ~13B IDR total */
export const PORTFOLIO_HOLDINGS = [
  { symbol: "BBCA", lots: 2000, avgPrice: 9200,  sector: "Keuangan" },
  { symbol: "BBRI", lots: 3500, avgPrice: 3950,  sector: "Keuangan" },
  { symbol: "TLKM", lots: 5000, avgPrice: 2780,  sector: "Telekomunikasi" },
  { symbol: "ASII", lots: 2800, avgPrice: 4350,  sector: "Konglomerasi" },
  { symbol: "BREN", lots: 1200, avgPrice: 7400,  sector: "Energi" },
  { symbol: "ADRO", lots: 4000, avgPrice: 2120,  sector: "Energi" },
  { symbol: "BMRI", lots: 3000, avgPrice: 5200,  sector: "Keuangan" },
  { symbol: "UNVR", lots: 2200, avgPrice: 3200,  sector: "Konsumer" },
  { symbol: "ICBP", lots: 1500, avgPrice: 9100,  sector: "Konsumer" },
  { symbol: "ANTM", lots: 6000, avgPrice: 1540,  sector: "Material"  },
] as const;

/* 12-month portfolio history (IDR)
 *
 * Removed. The Portfolio page drew this bundled sample as its equity curve with
 * no provenance marker, beside a live allocation table — a chart of a portfolio
 * history that never happened. GET /v1/portfolio/equity now computes the real
 * thing from session closes times held lots, and serves an empty `points` list
 * when there is not enough history rather than inventing a substitute.
 *
 * Left as prose rather than code so it is not re-wired back as a fallback: a
 * viewer could not tell which curve they were looking at, which is the whole
 * problem it caused.
 */

export const SECTOR_ALLOCATION = [
  { name: "Keuangan",       nameEn: "Financials",   value: 40.2 },
  { name: "Energi",         nameEn: "Energy",       value: 16.8 },
  { name: "Konsumer",       nameEn: "Consumer",     value: 14.0 },
  { name: "Telekomunikasi", nameEn: "Telecom",      value: 11.4 },
  { name: "Konglomerasi",   nameEn: "Conglomerate", value: 10.4 },
  { name: "Material",       nameEn: "Materials",    value: 7.2  },
] as const;

/* uprob = upward probability % (OJK-compliant output replacing absolute buy/sell signals)
   shap  = SHAP factor contributions (positive = bullish, negative = bearish) */
export const AI_RECOMMENDATIONS = [
  {
    id: 1,
    symbol: "BREN",
    name: "Barito Renewables Energy",
    probabilityTier: "VERY_HIGH" as const,
    uprob: 88,
    confidence: 88,
    targetPrice: 10200,
    currentPrice: 8450,
    upside: 20.7,
    horizon: "6–12 bln",    horizonEn: "6–12 months",
    risk: "Sedang-Tinggi",  riskEn: "Medium-High",
    thesis: "Permintaan energi terbarukan Indonesia meningkat pesat. BREN sebagai pemegang konsesi panas bumi terbesar di ASEAN memiliki keunggulan kompetitif yang tak tertandingi. Target bauran EBT 23% oleh pemerintah 2025 menjadi katalis utama.",
    thesisEn: "Indonesian renewable energy demand accelerating rapidly. BREN as the largest geothermal concessionaire in ASEAN holds unmatched competitive position. Government 23% renewable target by 2025 is the primary catalyst.",
    catalysts: ["Kontrak PLN baru senilai Rp 4,2T", "IPO anak usaha panas bumi Q4 2026", "Ekspansi kapasitas 1,2 GW 2026–2028"],
    catalystsEn: ["New PLN contract worth Rp 4.2T", "Geothermal subsidiary IPO Q4 2026", "1.2 GW capacity expansion 2026–2028"],
    modelScore: 91.4,
    analystConsensus: "—",
    analystConsensusEn: "—",
    shap: [
      { factor: "Fundamental",   factorEn: "Fundamentals",  value: 22 },
      { factor: "Foreign Flow",  factorEn: "Foreign Flow",  value: 18 },
      { factor: "Teknikal",      factorEn: "Technical",     value: 16 },
      { factor: "Sentimen",      factorEn: "Sentiment",     value: 12 },
      { factor: "Makro",         factorEn: "Macro",         value: 8  },
      { factor: "Volume",        factorEn: "Volume",        value: 6  },
      { factor: "Risiko",        factorEn: "Risk",          value: -6 },
    ],
  },
  {
    id: 2,
    symbol: "BBCA",
    name: "Bank Central Asia",
    probabilityTier: "HIGH" as const,
    uprob: 82,
    confidence: 82,
    targetPrice: 11500,
    currentPrice: 9850,
    upside: 16.8,
    horizon: "9–15 bln",  horizonEn: "9–15 months",
    risk: "Rendah",       riskEn: "Low",
    thesis: "Bank terbaik ASEAN dengan ROE 22% dan NPL 1,3%. Pertumbuhan kredit konsumen +18% YoY didorong digitalisasi melalui myBCA. Valuasi premium masih wajar mengingat kualitas franchise kelas dunia.",
    thesisEn: "Best-in-class ASEAN bank with 22% ROE and 1.3% NPL. Consumer credit growth +18% YoY driven by myBCA digital platform. Premium valuation justified by world-class franchise quality.",
    catalysts: ["Ekspansi kredit korporasi +22% YoY", "Fee income tumbuh dari transaksi digital", "Dividen interim Q3 2026"],
    catalystsEn: ["Corporate credit expansion +22% YoY", "Digital transaction fee income growth", "Q3 2026 interim dividend"],
    modelScore: 84.7,
    analystConsensus: "—",
    analystConsensusEn: "—",
    shap: [
      { factor: "Fundamental",   factorEn: "Fundamentals",  value: 24 },
      { factor: "Teknikal",      factorEn: "Technical",     value: 14 },
      { factor: "Sentimen",      factorEn: "Sentiment",     value: 12 },
      { factor: "Foreign Flow",  factorEn: "Foreign Flow",  value: 10 },
      { factor: "Volume",        factorEn: "Volume",        value: 7  },
      { factor: "Makro",         factorEn: "Macro",         value: 5  },
      { factor: "Risiko",        factorEn: "Risk",          value: -4 },
    ],
  },
  {
    id: 3,
    symbol: "ADRO",
    name: "Adaro Energy Indonesia",
    probabilityTier: "HIGH" as const,
    uprob: 76,
    confidence: 76,
    targetPrice: 3100,
    currentPrice: 2520,
    upside: 23.0,
    horizon: "6–9 bln",   horizonEn: "6–9 months",
    risk: "Sedang",       riskEn: "Medium",
    thesis: "Dividend yield 8,4% sangat menarik. Transformasi ke aluminium dan EBT via Adaro Andalan mengurangi ketergantungan batu bara jangka panjang. Undervalued signifikan vs peers Asia dengan EV/EBITDA 4,2x.",
    thesisEn: "8.4% dividend yield highly attractive. Transformation to aluminum and renewables via Adaro Andalan reduces long-term coal dependency. Significantly undervalued vs Asian peers at EV/EBITDA 4.2x.",
    catalysts: ["Smelter aluminium Kalimantan mulai produksi", "Akuisisi ladang batu bara metalurgi", "Spin-off Adaro Clean Energy 2026"],
    catalystsEn: ["Kalimantan aluminum smelter starts production", "Metallurgical coal field acquisition", "Adaro Clean Energy spin-off 2026"],
    modelScore: 78.1,
    analystConsensus: "—",
    analystConsensusEn: "—",
    shap: [
      { factor: "Fundamental",   factorEn: "Fundamentals",  value: 19 },
      { factor: "Volume",        factorEn: "Volume",        value: 14 },
      { factor: "Makro",         factorEn: "Macro",         value: 12 },
      { factor: "Teknikal",      factorEn: "Technical",     value: 10 },
      { factor: "Sentimen",      factorEn: "Sentiment",     value: 8  },
      { factor: "Foreign Flow",  factorEn: "Foreign Flow",  value: 5  },
      { factor: "Risiko",        factorEn: "Risk",          value: -7 },
    ],
  },
  {
    id: 4,
    symbol: "GOTO",
    name: "GoTo Gojek Tokopedia",
    probabilityTier: "NEUTRAL" as const,
    uprob: 52,
    confidence: 59,
    targetPrice: 78,
    currentPrice: 68,
    upside: 14.7,
    horizon: "12–18 bln", horizonEn: "12–18 months",
    risk: "Tinggi",       riskEn: "High",
    thesis: "Jalan menuju profitabilitas masih panjang. GTV tumbuh +11% YoY namun burn rate tetap tinggi. Tekanan persaingan dari Shopee dan TikTok Shop mengancam pangsa pasar e-commerce. Sizing terbatas.",
    thesisEn: "Path to profitability remains long. GTV growing +11% YoY but burn rate remains elevated. Competitive pressure from Shopee and TikTok Shop threatens e-commerce market share. Limited position sizing.",
    catalysts: ["EBITDA breakeven dijanjikan Q2 2026", "Paket monetisasi GoFood baru", "Konsolidasi sektor teknologi Indonesia"],
    catalystsEn: ["Promised EBITDA breakeven Q2 2026", "GoFood new monetization packages", "Indonesia tech sector consolidation"],
    modelScore: 52.3,
    analystConsensus: "—",
    analystConsensusEn: "—",
    shap: [
      { factor: "Sentimen",      factorEn: "Sentiment",     value: 9  },
      { factor: "Teknikal",      factorEn: "Technical",     value: 5  },
      { factor: "Fundamental",   factorEn: "Fundamentals",  value: 3  },
      { factor: "Volume",        factorEn: "Volume",        value: -4 },
      { factor: "Foreign Flow",  factorEn: "Foreign Flow",  value: -6 },
      { factor: "Risiko",        factorEn: "Risk",          value: -9 },
      { factor: "Makro",         factorEn: "Macro",         value: -11 },
    ],
  },
  {
    id: 5,
    symbol: "TLKM",
    name: "Telkom Indonesia",
    probabilityTier: "LOW" as const,
    uprob: 29,
    confidence: 71,
    targetPrice: 2400,
    currentPrice: 2940,
    upside: -18.4,
    horizon: "3–6 bln",   horizonEn: "3–6 months",
    risk: "Sedang",       riskEn: "Medium",
    thesis: "Tekanan margin dari persaingan broadband semakin intensif. IndiHome kehilangan pelanggan ke WiFi murah dan Starlink. Pendapatan enterprise stagnan. Valuasi premium tidak didukung pertumbuhan pendapatan yang melambat.",
    thesisEn: "Margin pressure from intensifying broadband competition. IndiHome losing subscribers to cheap WiFi and Starlink. Enterprise revenue stagnant. Premium valuation unsupported by decelerating revenue growth.",
    catalysts: ["Data pelanggan IndiHome Q2 2026", "Perpanjangan lisensi spektrum 5G", "Perlambatan Telkomsel dari persaingan"],
    catalystsEn: ["Q2 2026 IndiHome subscriber data", "5G spectrum license renewal terms", "Telkomsel growth slowdown from competition"],
    modelScore: 28.6,
    analystConsensus: "—",
    analystConsensusEn: "—",
    shap: [
      { factor: "Fundamental",   factorEn: "Fundamentals",  value: -18 },
      { factor: "Sentimen",      factorEn: "Sentiment",     value: -14 },
      { factor: "Foreign Flow",  factorEn: "Foreign Flow",  value: -12 },
      { factor: "Teknikal",      factorEn: "Technical",     value: -8  },
      { factor: "Volume",        factorEn: "Volume",        value: 4   },
      { factor: "Makro",         factorEn: "Macro",         value: 2   },
      { factor: "Risiko",        factorEn: "Risk",          value: -3  },
    ],
  },
] as const;

export const RISK_DATA = {
  overallRisk:       44,
  marketRisk:        58,
  concentrationRisk: 52,
  liquidityRisk:     22,
  currencyRisk:      31,
  creditRisk:        12,
  var95:             -384_720_000,
  cvar95:            -562_480_000,
  volatility:        14.8,
  maxDrawdown:       -9.6,
  beta:              0.94,
  sharpe:            1.71,
  sortino:           2.18,
  alpha:             3.1,
  informationRatio:  0.82,
} as const;

export const STRESS_TESTS = [
  { scenario: "Krisis Keuangan 2008",      scenarioEn: "2008 Financial Crisis",     impact: -34.2, probability: 2.8  },
  { scenario: "Pandemi COVID-19",          scenarioEn: "COVID-19 Pandemic",         impact: -26.8, probability: 4.1  },
  { scenario: "Krisis Rupiah 1998",        scenarioEn: "1998 Rupiah Crisis",        impact: -41.5, probability: 1.4  },
  { scenario: "Siklus Kenaikan BI Rate",   scenarioEn: "BI Rate Hike Cycle",        impact: -14.3, probability: 18.6 },
  { scenario: "Koreksi Komoditas -30%",    scenarioEn: "Commodity Correction -30%", impact: -8.7,  probability: 21.4 },
  { scenario: "Resesi Ringan",             scenarioEn: "Mild Recession",            impact: -11.2, probability: 26.8 },
  { scenario: "Guncangan Geopolitik",      scenarioEn: "Geopolitical Shock",        impact: -10.4, probability: 24.9 },
] as const;

export const SECTOR_EXPOSURE = [
  { sector: "Keuangan",       sectorEn: "Financials",   weight: 40.2, benchmark: 34.2, overUnder: 6.0  },
  { sector: "Energi",         sectorEn: "Energy",       weight: 16.8, benchmark: 12.4, overUnder: 4.4  },
  { sector: "Konsumer",       sectorEn: "Consumer",     weight: 14.0, benchmark: 16.8, overUnder: -2.8 },
  { sector: "Telekomunikasi", sectorEn: "Telecom",      weight: 11.4, benchmark: 10.3, overUnder: 1.1  },
  { sector: "Konglomerasi",   sectorEn: "Conglomerate", weight: 10.4, benchmark: 11.6, overUnder: -1.2 },
  { sector: "Material",       sectorEn: "Materials",    weight: 7.2,  benchmark: 6.2,  overUnder: 1.0  },
] as const;

export const RECENT_TRANSACTIONS = [
  { id: 1, date: "24 Jul 2026", time: "14:32", type: "BUY"    as const, symbol: "BREN", lots: 20,  price: 8400, total: 16_800_000  },
  { id: 2, date: "23 Jul 2026", time: "10:15", type: "SELL"   as const, symbol: "GOTO", lots: 500, price: 70,   total: 3_500_000   },
  { id: 3, date: "22 Jul 2026", time: "13:44", type: "BUY"    as const, symbol: "ADRO", lots: 50,  price: 2480, total: 12_400_000  },
  { id: 4, date: "21 Jul 2026", time: "09:28", type: "BUY"    as const, symbol: "ANTM", lots: 100, price: 1820, total: 18_200_000  },
  { id: 5, date: "18 Jul 2026", time: "11:52", type: "SELL"   as const, symbol: "TLKM", lots: 100, price: 3010, total: 30_100_000  },
  { id: 6, date: "17 Jul 2026", time: "15:20", type: "DIVIDEN" as const, symbol: "BBCA", lots: 0, price: 0,    total: 4_200_000   },
  { id: 7, date: "15 Jul 2026", time: "10:02", type: "BUY"    as const, symbol: "BBRI", lots: 50,  price: 4240, total: 21_200_000  },
  { id: 8, date: "14 Jul 2026", time: "14:08", type: "BUY"    as const, symbol: "BMRI", lots: 30,  price: 5720, total: 17_160_000  },
] as const;

export const ALERTS_DATA = [
  { id: 1, type: "signal"    as const, severity: "high"   as const, msgId: "BREN mendekati target Rp 10.200 — pertimbangkan ambil untung sebagian",              msgEn: "BREN approaching target Rp 10,200 — consider partial profit-taking",              timeId: "18 mnt lalu",  timeEn: "18 min ago" },
  { id: 2, type: "risk"      as const, severity: "medium" as const, msgId: "Eksposur Keuangan naik ke 40,2% — di atas ambang batas 38%",                          msgEn: "Financials exposure rose to 40.2% — above 38% threshold",                        timeId: "1 jam lalu",   timeEn: "1 hr ago"   },
  { id: 3, type: "macro"     as const, severity: "medium" as const, msgId: "BI pertahankan suku bunga 5,75% — sesuai ekspektasi pasar",                           msgEn: "BI holds rate at 5.75% — in line with market expectations",                      timeId: "2 jam lalu",   timeEn: "2 hr ago"   },
  { id: 4, type: "signal"    as const, severity: "high"   as const, msgId: "Model AI: Probabilitas Naik ADRO = 76% — dividend yield 8,4% (Tier 1, LQ45)",       msgEn: "AI Model: ADRO Upward Probability = 76% — 8.4% dividend yield (Tier 1, LQ45)",  timeId: "4 jam lalu",   timeEn: "4 hr ago"   },
  { id: 5, type: "rebalance" as const, severity: "low"    as const, msgId: "Rebalancing disarankan: bobot Keuangan 40,2% melampaui target 38%",                    msgEn: "Rebalancing suggested: Financials weight 40.2% exceeds 38% target",              timeId: "6 jam lalu",   timeEn: "6 hr ago"   },
] as const;
