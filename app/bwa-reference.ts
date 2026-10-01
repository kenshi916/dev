// Dated, read-only chain research. Never used as fresh launch evidence.
export const BWA_REFERENCE_CASE = {
  "checkedAt": "2026-10-01T12:47:48.015Z",
  "wallet": "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa",
  "scope": "Five selected transactions from a bounded recent wallet-address sample. This is not complete wallet history, lifetime PNL, or complete per-coin profit.",
  "name": "robotics coin",
  "symbol": "robotics",
  "mint": "2EjmSFMJAoDWY8KDTX8fX8UE7xynccsQbjXoagn16uMp",
  "deployedAt": "2026-10-01T03:32:36.000Z",
  "holdingSeconds": 6,
  "cashflowLamports": -120630648,
  "launchTradeCashflowLamports": -112641408,
  "setupDebitLamports": 7989240,
  "aggregateCreatorReceiptLamports": 29950879,
  "observation": "The observed token position was fully sold within six seconds. Launch, buy, two sells and fee setup produced negative wallet cashflow; fast execution did not guarantee a winning result.",
  "limitation": "Selected transactions only, not complete coin profit or lifetime earnings. The source tweet, artwork and competing launch order are unverified. Aggregate creator-vault fees cannot be assigned to this coin.",
  "sources": [
    {
      "label": "create",
      "url": "https://solscan.io/tx/oALbki7Vg6jXQWaNSPtzTDfhYY59LR3294beL5AqhhHitd54FwoYZGvDx9ihSEvWtsiNh9o2q3C8pyDey4e3vMH"
    },
    {
      "label": "fee-setup",
      "url": "https://solscan.io/tx/27wbbnbiDnbv3kmW6kvGvJ5sgfa4nXmxf9NZe3XU62acMXKQ8X2E9tinq4n45pGeFjYCrysjayTW3PWPdzdKoTFb"
    },
    {
      "label": "sell-one",
      "url": "https://solscan.io/tx/5QKCFMDw8yA6GbjDsPXqCw66vzMRuAzbqSJE7nZtTFqTYdzdcP9yYsSXU8ryr2dorGkEMzSCj5A455H11SMK4WxZ"
    },
    {
      "label": "sell-two",
      "url": "https://solscan.io/tx/3XAqYn3zZis7TM77MEtdkZGRCbH32ayLBiKTKDTCALAKHRy9JBnvjbskSvsrkqwF11A1doswvom5SFeUiUyQHXjP"
    },
    {
      "label": "aggregate-fee-collection",
      "url": "https://solscan.io/tx/5u4BRVDidunFKMpuf5R8XmHF7zi3dZ3LpYYSzekkH9P2fPoGmSXyL3FusnrSRbSv22MqixR5AWPCfcjKwpiiJJTg"
    }
  ]
} as const;
