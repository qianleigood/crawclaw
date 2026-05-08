<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
  zhCN,
  enUS,
  dateZhCN,
  dateEnUS,
} from "naive-ui";
import type { GlobalThemeOverrides } from "naive-ui";
import { useI18n } from "vue-i18n";
import { useTheme } from "@/composables/useTheme";
import { useLocaleStore } from "@/stores/locale";
import { useDesktopStore } from "@/stores/desktop";

const { theme } = useTheme();
const route = useRoute();
const localeStore = useLocaleStore();
const desktopStore = useDesktopStore();
const { t } = useI18n();

const naiveLocale = computed(() =>
  localeStore.locale === "zh-CN" ? zhCN : enUS,
);
const naiveDateLocale = computed(() =>
  localeStore.locale === "zh-CN" ? dateZhCN : dateEnUS,
);
const themeOverrides = computed<GlobalThemeOverrides>(() => ({
  common: {
    primaryColor: "#007aff",
    primaryColorHover: "#0066d6",
    primaryColorPressed: "#0057b8",
    primaryColorSuppl: "#409cff",
    borderRadius: "9px",
    borderColor: "rgba(60, 60, 67, 0.14)",
    fontWeightStrong: "650",
  },
  Button: {
    borderRadiusMedium: "9px",
    borderRadiusSmall: "8px",
    fontWeight: "600",
  },
  Card: {
    borderRadius: "14px",
  },
}));

watch(
  () =>
    [route.meta.titleKey as string | undefined, localeStore.locale, desktopStore.isDesktopMode] as const,
  ([titleKey]) => {
    if (typeof document === "undefined") return;
    const productTitle = desktopStore.isDesktopMode ? "CrawClaw Desktop" : "CrawClaw Admin";
    if (!titleKey) {
      document.title = productTitle;
      return;
    }
    const title = t(titleKey);
    document.title = `${title} - ${productTitle}`;
  },
  { immediate: true },
);
</script>

<template>
  <NConfigProvider
    :theme="theme"
    :theme-overrides="themeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
  >
    <NNotificationProvider>
      <NMessageProvider>
        <NDialogProvider>
          <RouterView />
        </NDialogProvider>
      </NMessageProvider>
    </NNotificationProvider>
  </NConfigProvider>
</template>
