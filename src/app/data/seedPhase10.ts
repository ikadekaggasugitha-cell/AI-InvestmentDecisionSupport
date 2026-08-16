/**
 * Phase 10 seed data — price action, trade plans and broker flow.
 *
 * Generated from the backend mock generators (ingestor/ohlcv_mock.py,
 * ingestor/broksum_mock.py) so every number here agrees with what the API
 * returns in mock mode: the stop loss sits on a support level that genuinely
 * appears in the candles below, and the broker phase reflects the same
 * simulated flow.
 *
 * This is SIMULATED data for the offline demo path (USE_LIVE_API = false). The
 * broker codes name real Indonesian securities firms — BrokerSummaryPanel
 * labels the source accordingly, and that label must not be removed.
 *
 * To regenerate: re-run the generator with a new AS_OF date. Candles are
 * [date, open, high, low, close, volume] tuples to keep the bundle small.
 */

import type {
  BrokerSummarySnapshot,
  GapInfo,
  SRLevel,
  TradePlan,
  TrendInfo,
} from "../hooks/useAISignals";

export interface SignalEnrichment {
  tradePlan: TradePlan | null;
  technicalNote: string;
  technicalNoteEn: string;
  trend: TrendInfo;
  supportResistance: SRLevel[];
  activePatterns: string[];
  activePatternsEn: string[];
  openGaps: GapInfo[];
  brokerSummary: BrokerSummarySnapshot;
}


export const SEED_ENRICHMENT: Record<string, SignalEnrichment> = {
  "BREN": {
    "tradePlan": null,
    "technicalNote": "Tren downtrend (kekuatan 95/100). Pola Bearish Engulfing terdeteksi. Akumulasi: broker DB net +6.186 lot dalam 5 hari.",
    "technicalNoteEn": "Downtrend (strength 95/100). Bearish Engulfing pattern detected. Accumulation: broker DB net +6,186 lots over 5 days.",
    "trend": {
      "trend": "downtrend",
      "trendId": "Downtrend",
      "strength": 95,
      "emaFast": 8882.35,
      "emaSlow": 9099.67
    },
    "supportResistance": [
      {
        "type": "resistance",
        "price": 9612.5,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 9737.5,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 10060.0,
        "strength": 5,
        "touches": 5,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 10341.67,
        "strength": 3,
        "touches": 3,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 10537.5,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      }
    ],
    "activePatterns": [
      "Bearish Engulfing"
    ],
    "activePatternsEn": [
      "Bearish Engulfing"
    ],
    "openGaps": [],
    "brokerSummary": {
      "phase": "accumulation",
      "phaseId": "Akumulasi",
      "score": 85.6,
      "topBuyers": [
        {
          "broker": "DB",
          "netLot5d": 6186,
          "netLot20d": 15353
        },
        {
          "broker": "KI",
          "netLot5d": 5955,
          "netLot20d": 18381
        },
        {
          "broker": "ZP",
          "netLot5d": 5369,
          "netLot20d": 17143
        }
      ],
      "topSellers": [
        {
          "broker": "FZ",
          "netLot5d": 301,
          "netLot20d": 2262
        },
        {
          "broker": "IF",
          "netLot5d": 498,
          "netLot20d": 2923
        },
        {
          "broker": "PD",
          "netLot5d": 558,
          "netLot20d": 3781
        }
      ],
      "netLot5d": 50899,
      "netLot20d": 188046,
      "consistencyDays": 22,
      "concentration": 0.0751
    }
  },
  "BBCA": {
    "tradePlan": {
      "entryPrice": 9850.0,
      "stopLoss": 9691.67,
      "stopLossPct": -1.61,
      "stopLossReason": "Support fraktal terdekat (3× tersentuh)",
      "stopLossReasonEn": "Nearest fractal support (3 touches)",
      "riskRewardRatio": 10.42
    },
    "technicalNote": "Stop loss Rp 9.692 (-1.6%) berdasarkan support fraktal terdekat (3× tersentuh). Pola Bullish Engulfing terdeteksi. Gap up 1.05% belum tertutup (probabilitas penutupan historis 80%). Akumulasi: broker YP net +3.860 lot dalam 5 hari.",
    "technicalNoteEn": "Stop loss Rp 9.692 (-1.6%) based on nearest fractal support (3 touches). Bullish Engulfing pattern detected. Unfilled gap up of 1.05% (historical fill probability 80%). Accumulation: broker YP net +3,860 lots over 5 days.",
    "trend": {
      "trend": "sideways",
      "trendId": "Sideways",
      "strength": 44,
      "emaFast": 9687.22,
      "emaSlow": 9628.43
    },
    "supportResistance": [
      {
        "type": "support",
        "price": 9850.0,
        "strength": 3,
        "touches": 3,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 9712.5,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      },
      {
        "type": "support",
        "price": 9691.67,
        "strength": 3,
        "touches": 3,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 10143.75,
        "strength": 4,
        "touches": 4,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 10362.5,
        "strength": 4,
        "touches": 4,
        "method": "fractal"
      },
      {
        "type": "support",
        "price": 9287.5,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      },
      {
        "type": "support",
        "price": 9000.0,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      }
    ],
    "activePatterns": [
      "Doji",
      "Doji",
      "Doji",
      "Bullish Engulfing"
    ],
    "activePatternsEn": [
      "Doji",
      "Doji",
      "Doji",
      "Bullish Engulfing"
    ],
    "openGaps": [
      {
        "type": "gap_up",
        "date": "2026-02-20",
        "gapPct": 1.05,
        "top": 7225.0,
        "bottom": 7150.0,
        "isFilled": false,
        "fillProbability": 0.8,
        "avgFillDays": null
      }
    ],
    "brokerSummary": {
      "phase": "accumulation",
      "phaseId": "Akumulasi",
      "score": 85.2,
      "topBuyers": [
        {
          "broker": "YP",
          "netLot5d": 3860,
          "netLot20d": 11274
        },
        {
          "broker": "KZ",
          "netLot5d": 3350,
          "netLot20d": 8635
        },
        {
          "broker": "ZP",
          "netLot5d": 3276,
          "netLot20d": 9861
        }
      ],
      "topSellers": [
        {
          "broker": "FZ",
          "netLot5d": 272,
          "netLot20d": 1489
        },
        {
          "broker": "LG",
          "netLot5d": 457,
          "netLot20d": 2652
        },
        {
          "broker": "PD",
          "netLot5d": 467,
          "netLot20d": 2390
        }
      ],
      "netLot5d": 28867,
      "netLot20d": 121619,
      "consistencyDays": 22,
      "concentration": 0.0766
    }
  },
  "ADRO": {
    "tradePlan": {
      "entryPrice": 2520.0,
      "stopLoss": 2325.0,
      "stopLossPct": -7.74,
      "stopLossReason": "Support fraktal terdekat (2× tersentuh)",
      "stopLossReasonEn": "Nearest fractal support (2 touches)",
      "riskRewardRatio": 2.97
    },
    "technicalNote": "Stop loss Rp 2.325 (-7.7%) berdasarkan support fraktal terdekat (2× tersentuh). Pola Three White Soldiers terdeteksi. Akumulasi: broker ZP net +2.001 lot dalam 5 hari.",
    "technicalNoteEn": "Stop loss Rp 2.325 (-7.7%) based on nearest fractal support (2 touches). Three White Soldiers pattern detected. Accumulation: broker ZP net +2,001 lots over 5 days.",
    "trend": {
      "trend": "sideways",
      "trendId": "Sideways",
      "strength": 19,
      "emaFast": 2509.38,
      "emaSlow": 2591.69
    },
    "supportResistance": [
      {
        "type": "support",
        "price": 2526.67,
        "strength": 3,
        "touches": 3,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 2650.0,
        "strength": 5,
        "touches": 5,
        "method": "fractal"
      },
      {
        "type": "support",
        "price": 2325.0,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 2830.0,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 2895.0,
        "strength": 4,
        "touches": 4,
        "method": "fractal"
      }
    ],
    "activePatterns": [
      "Three White Soldiers"
    ],
    "activePatternsEn": [
      "Three White Soldiers"
    ],
    "openGaps": [],
    "brokerSummary": {
      "phase": "accumulation",
      "phaseId": "Akumulasi",
      "score": 73.0,
      "topBuyers": [
        {
          "broker": "ZP",
          "netLot5d": 2001,
          "netLot20d": 5569
        },
        {
          "broker": "CC",
          "netLot5d": 1492,
          "netLot20d": 3434
        },
        {
          "broker": "DB",
          "netLot5d": 1398,
          "netLot20d": 6604
        }
      ],
      "topSellers": [
        {
          "broker": "AF",
          "netLot5d": -40,
          "netLot20d": 664
        },
        {
          "broker": "RX",
          "netLot5d": 63,
          "netLot20d": 1169
        },
        {
          "broker": "PD",
          "netLot5d": 97,
          "netLot20d": 621
        }
      ],
      "netLot5d": 10033,
      "netLot20d": 50551,
      "consistencyDays": 22,
      "concentration": 0.1017
    }
  },
  "GOTO": {
    "tradePlan": {
      "entryPrice": 68.0,
      "stopLoss": 66.0,
      "stopLossPct": -2.94,
      "stopLossReason": "Support fraktal terdekat (4× tersentuh)",
      "stopLossReasonEn": "Nearest fractal support (4 touches)",
      "riskRewardRatio": 5.0
    },
    "technicalNote": "Stop loss Rp 66 (-2.9%) berdasarkan support fraktal terdekat (4× tersentuh). Pola Doji terdeteksi. Distribusi: broker FZ net -199 lot dalam 5 hari.",
    "technicalNoteEn": "Stop loss Rp 66 (-2.9%) based on nearest fractal support (4 touches). Doji pattern detected. Distribution: broker FZ net -199 lots over 5 days.",
    "trend": {
      "trend": "sideways",
      "trendId": "Sideways",
      "strength": 50,
      "emaFast": 69.05,
      "emaSlow": 68.99
    },
    "supportResistance": [
      {
        "type": "support",
        "price": 67.25,
        "strength": 4,
        "touches": 4,
        "method": "fractal"
      },
      {
        "type": "support",
        "price": 66.0,
        "strength": 4,
        "touches": 4,
        "method": "fractal"
      }
    ],
    "activePatterns": [
      "Doji",
      "Doji",
      "Bearish Engulfing",
      "Doji"
    ],
    "activePatternsEn": [
      "Doji",
      "Doji",
      "Bearish Engulfing",
      "Doji"
    ],
    "openGaps": [],
    "brokerSummary": {
      "phase": "distribution",
      "phaseId": "Distribusi",
      "score": -85.1,
      "topBuyers": [
        {
          "broker": "FZ",
          "netLot5d": -199,
          "netLot20d": -1349
        },
        {
          "broker": "AF",
          "netLot5d": -227,
          "netLot20d": -1819
        },
        {
          "broker": "PD",
          "netLot5d": -458,
          "netLot20d": -1891
        }
      ],
      "topSellers": [
        {
          "broker": "CC",
          "netLot5d": -4329,
          "netLot20d": -7842
        },
        {
          "broker": "KZ",
          "netLot5d": -3477,
          "netLot20d": -7255
        },
        {
          "broker": "KI",
          "netLot5d": -2642,
          "netLot20d": -8580
        }
      ],
      "netLot5d": -30670,
      "netLot20d": -104208,
      "consistencyDays": 22,
      "concentration": 0.0733
    }
  },
  "TLKM": {
    "tradePlan": {
      "entryPrice": 2940.0,
      "stopLoss": 2868.0,
      "stopLossPct": -2.45,
      "stopLossReason": "Support fraktal terdekat (5× tersentuh)",
      "stopLossReasonEn": "Nearest fractal support (5 touches)",
      "riskRewardRatio": null
    },
    "technicalNote": "Stop loss Rp 2.868 (-2.5%) berdasarkan support fraktal terdekat (5× tersentuh). Pola Bullish Engulfing terdeteksi. Distribusi: broker ZP net +92 lot dalam 5 hari.",
    "technicalNoteEn": "Stop loss Rp 2.868 (-2.5%) based on nearest fractal support (5 touches). Bullish Engulfing pattern detected. Distribution: broker ZP net +92 lots over 5 days.",
    "trend": {
      "trend": "sideways",
      "trendId": "Sideways",
      "strength": 42,
      "emaFast": 2949.17,
      "emaSlow": 2973.45
    },
    "supportResistance": [
      {
        "type": "support",
        "price": 2960.0,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      },
      {
        "type": "support",
        "price": 2913.33,
        "strength": 3,
        "touches": 3,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 2996.67,
        "strength": 3,
        "touches": 3,
        "method": "fractal"
      },
      {
        "type": "support",
        "price": 2868.0,
        "strength": 5,
        "touches": 5,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 3025.0,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      },
      {
        "type": "support",
        "price": 2790.0,
        "strength": 2,
        "touches": 2,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 3120.0,
        "strength": 4,
        "touches": 4,
        "method": "fractal"
      },
      {
        "type": "resistance",
        "price": 3245.0,
        "strength": 4,
        "touches": 4,
        "method": "fractal"
      }
    ],
    "activePatterns": [
      "Doji",
      "Bullish Engulfing"
    ],
    "activePatternsEn": [
      "Doji",
      "Bullish Engulfing"
    ],
    "openGaps": [],
    "brokerSummary": {
      "phase": "distribution",
      "phaseId": "Distribusi",
      "score": -65.8,
      "topBuyers": [
        {
          "broker": "ZP",
          "netLot5d": 92,
          "netLot20d": -2118
        },
        {
          "broker": "FZ",
          "netLot5d": -33,
          "netLot20d": -709
        },
        {
          "broker": "LG",
          "netLot5d": -43,
          "netLot20d": -660
        }
      ],
      "topSellers": [
        {
          "broker": "KZ",
          "netLot5d": -1475,
          "netLot20d": -3136
        },
        {
          "broker": "DB",
          "netLot5d": -1252,
          "netLot20d": -2943
        },
        {
          "broker": "KI",
          "netLot5d": -1181,
          "netLot20d": -2343
        }
      ],
      "netLot5d": -8174,
      "netLot20d": -35819,
      "consistencyDays": 5,
      "concentration": 0.1057
    }
  }
};
