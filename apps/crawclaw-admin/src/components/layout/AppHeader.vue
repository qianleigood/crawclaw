<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NBreadcrumb, NBreadcrumbItem, NButton, NSpace, NTooltip, NIcon } from 'naive-ui'
import { SunnyOutline, MoonOutline, LogOutOutline, LanguageOutline, ExpandOutline, ContractOutline } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { useWebSocketStore } from '@/stores/websocket'
import { useWideModeStore } from '@/stores/wideMode'
import { useDesktopStore } from '@/stores/desktop'
import ConnectionStatus from '@/components/common/ConnectionStatus.vue'
import GatewaySwitcher from '@/components/common/GatewaySwitcher.vue'

const route = useRoute()
const router = useRouter()
const { isDark, toggle } = useTheme()
const authStore = useAuthStore()
const localeStore = useLocaleStore()
const wsStore = useWebSocketStore()
const wideModeStore = useWideModeStore()
const desktopStore = useDesktopStore()
const { t } = useI18n()

const breadcrumbs = computed(() => {
  const items: { label: string; name?: string }[] = [{ label: t('common.home'), name: 'Dashboard' }]
  if (route.name !== 'Dashboard') {
    const titleKey = route.meta.titleKey as string | undefined
    const fallbackTitle = route.meta.title as string | undefined
    items.push({ label: titleKey ? t(titleKey) : (fallbackTitle || '') })
  }
  return items
})

const languageToggleTarget = computed(() => (localeStore.locale === 'zh-CN' ? t('common.languageEn') : t('common.languageZh')))
const pageTitle = computed(() => {
  const titleKey = route.meta.titleKey as string | undefined
  const fallbackTitle = route.meta.title as string | undefined
  return titleKey ? t(titleKey) : (fallbackTitle || t('common.home'))
})

async function handleLogout() {
  wsStore.disconnect()
  await authStore.logout()
  router.push({ name: 'Login' })
}
</script>

<template>
  <div class="app-header" :class="{ 'app-header--desktop': desktopStore.isDesktopMode }">
    <div class="app-header__title-area">
      <template v-if="desktopStore.isDesktopMode">
        <div class="app-header__product">CrawClaw Desktop</div>
        <div class="app-header__title">{{ pageTitle }}</div>
      </template>
      <NBreadcrumb v-else>
        <NBreadcrumbItem
          v-for="(item, index) in breadcrumbs"
          :key="index"
          @click="item.name ? router.push({ name: item.name }) : undefined"
        >
          {{ item.label }}
        </NBreadcrumbItem>
      </NBreadcrumb>
    </div>

    <NSpace :size="8" align="center" class="app-header__actions">
      <ConnectionStatus />
      <GatewaySwitcher v-if="!desktopStore.isDesktopMode" />

      <NTooltip>
        <template #trigger>
          <NButton quaternary circle @click="toggle">
            <template #icon>
              <NIcon :component="isDark ? SunnyOutline : MoonOutline" />
            </template>
          </NButton>
        </template>
        {{ isDark ? t('common.switchToLight') : t('common.switchToDark') }}
      </NTooltip>

      <NTooltip v-if="!desktopStore.isDesktopMode">
        <template #trigger>
          <NButton quaternary circle @click="wideModeStore.toggle">
            <template #icon>
              <NIcon :component="wideModeStore.isWideMode ? ContractOutline : ExpandOutline" />
            </template>
          </NButton>
        </template>
        {{ wideModeStore.isWideMode ? t('common.switchToNormalWidth') : t('common.switchToWideMode') }}
      </NTooltip>

      <NTooltip>
        <template #trigger>
          <NButton quaternary circle @click="localeStore.toggle">
            <template #icon>
              <NIcon :component="LanguageOutline" />
            </template>
          </NButton>
        </template>
        {{ t('common.toggleLanguage', { target: languageToggleTarget }) }}
      </NTooltip>

      <NTooltip>
        <template #trigger>
          <NButton quaternary circle @click="handleLogout">
            <template #icon>
              <NIcon :component="LogOutOutline" />
            </template>
          </NButton>
        </template>
        {{ t('common.logout') }}
      </NTooltip>
    </NSpace>
  </div>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-width: 0;
}

.app-header__title-area {
  min-width: 0;
  flex: 1 1 auto;
}

.app-header__actions {
  flex-shrink: 0;
  min-width: 0;
}

.app-header--desktop .app-header__title-area {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.app-header__product {
  color: var(--desktop-text-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.app-header__title {
  color: var(--desktop-text-primary);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-header--desktop :deep(.n-button) {
  border-radius: 10px;
}
</style>
