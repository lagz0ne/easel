import type { Texts } from "@/kit/capsules/copy";

// The texts of the pricing frame, in each locale.

export const texts: Texts = {
  en: {
    "pricing.title": "Plans for each team",
    "pricing.per": "{price} a month",
    "pricing.choose": "Choose {plan}",
    "pricing.chosen": "Chosen",
    "pricing.features": { one: "{count} feature", other: "{count} features" },
  },
  vi: {
    "pricing.title": "Gói cho mỗi nhóm",
    "pricing.per": "{price} mỗi tháng",
    "pricing.choose": "Chọn {plan}",
    "pricing.chosen": "Đã chọn",
    "pricing.features": { one: "{count} tính năng", other: "{count} tính năng" },
  },
};
