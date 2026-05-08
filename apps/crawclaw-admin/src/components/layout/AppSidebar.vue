<script setup lang="ts">
import { h, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NMenu, NText } from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  GridOutline,
  ChatboxEllipsesOutline,
  ChatbubblesOutline,
  BookOutline,
  CalendarOutline,
  SparklesOutline,
  GitNetworkOutline,
  ExtensionPuzzleOutline,
  CogOutline,
  PulseOutline,
  FolderOutline,
  PeopleOutline,
  BusinessOutline,
  StorefrontOutline,
  ConstructOutline,
  TerminalOutline,
  DesktopOutline,
  ArchiveOutline,
  SettingsOutline,
  CodeSlashOutline,
  ImagesOutline,
  HardwareChipOutline,
  VolumeHighOutline,
} from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'
import { routes } from '@/router/routes'
import { useHermesConnectionStore } from '@/stores/hermes/connection'
import { useDesktopStore } from '@/stores/desktop'

defineProps<{ collapsed: boolean }>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const connStore = useHermesConnectionStore()
const desktopStore = useDesktopStore()
const hermesLogoSrc = `${import.meta.env.BASE_URL}hermes-logo.png`
const productName = computed(() => {
  if (desktopStore.isDesktopMode) { return 'CrawClaw Desktop' }
  return connStore.currentGateway === 'hermes' ? 'Hermes Agent' : 'CrawClaw Admin'
})

const desktopRouteGroups = [
  {
    labelKey: 'routes.nav.daily',
    names: ['Dashboard', 'Chat', 'Sessions'],
  },
  {
    labelKey: 'routes.nav.setup',
    names: ['Models', 'Channels', 'Settings'],
  },
  {
    labelKey: 'routes.nav.advanced',
    advanced: true,
    names: [
      'Memory',
      'Cron',
      'Workflows',
      'ComfyUI',
      'VoiceModule',
      'ESP32',
      'Skills',
      'Terminal',
      'RemoteDesktop',
      'Files',
      'Agents',
      'Office',
      'MyWorld',
      'Backup',
      'Monitor',
    ],
  },
] as const

const iconMap: Record<string, unknown> = {
  GridOutline,
  ChatboxEllipsesOutline,
  ChatbubblesOutline,
  BookOutline,
  CalendarOutline,
  SparklesOutline,
  GitNetworkOutline,
  ExtensionPuzzleOutline,
  CogOutline,
  PulseOutline,
  FolderOutline,
  PeopleOutline,
  BusinessOutline,
  StorefrontOutline,
  ConstructOutline,
  TerminalOutline,
  DesktopOutline,
  ArchiveOutline,
  SettingsOutline,
  CodeSlashOutline,
  ImagesOutline,
  HardwareChipOutline,
  VolumeHighOutline,
}

function renderIcon(iconName: string) {
  const icon = iconMap[iconName]
  if (!icon) return undefined
  return () => h(NIcon, null, { default: () => h(icon as any) })
}

const menuOptions = computed<MenuOption[]>(() => {
  const mainRoute = routes.find((r) => r.path === '/')
  if (!mainRoute?.children) return []

  const currentGateway = connStore.currentGateway
  const visibleRoutes = mainRoute.children.filter((child) => {
    if (child.meta?.hidden) return false

    const gateway = child.meta?.gateway as string | undefined
    if (desktopStore.isDesktopMode && child.meta?.desktopAdvanced && !desktopStore.advancedMode) {
      return false
    }

    return gateway === currentGateway
  })

  const toMenuItem = (child: NonNullable<typeof mainRoute.children>[number]): MenuOption => ({
    label: child.meta?.titleKey ? t(child.meta.titleKey as string) : (child.meta?.title as string),
    key: child.name as string,
    icon: child.meta?.icon ? renderIcon(child.meta.icon as string) : undefined,
  })

  if (desktopStore.isDesktopMode) {
    const routeByName = new Map(visibleRoutes.map((child) => [child.name as string, child]))
    return desktopRouteGroups
      .filter((group) => !('advanced' in group) || desktopStore.advancedMode)
      .map((group) => ({
        type: 'group',
        label: t(group.labelKey),
        key: group.labelKey,
        children: group.names
          .map((name) => routeByName.get(name))
          .filter((child): child is NonNullable<typeof mainRoute.children>[number] => Boolean(child))
          .map(toMenuItem),
      }))
      .filter((group) => group.children.length > 0) as MenuOption[]
  }

  return visibleRoutes.map(toMenuItem)
})

const activeKey = computed(() => {
  return route.name as string
})

function handleSelect(key: string) {
  router.push({ name: key })
}
</script>

<template>
  <div
    class="app-sidebar"
    :class="{
      'app-sidebar--desktop': desktopStore.isDesktopMode,
      'app-sidebar--collapsed': collapsed,
    }"
  >
    <div class="app-sidebar__brand">
      <img
        v-if="connStore.currentGateway === 'hermes'"
        :src="hermesLogoSrc"
        alt="Hermes"
        style="width: 24px; height: 24px; object-fit: contain;"
      />
      <span v-else-if="!desktopStore.isDesktopMode" class="app-sidebar__emoji">🦀</span>
      <span v-else class="app-sidebar__mark" aria-hidden="true">C</span>
      <NText
        v-if="!collapsed"
        strong
        class="app-sidebar__name"
      >
        {{ productName }}
      </NText>
    </div>

    <NMenu
      :value="activeKey"
      :collapsed="collapsed"
      :collapsed-width="64"
      :collapsed-icon-size="20"
      :options="menuOptions"
      :indent="24"
      @update:value="handleSelect"
    />
  </div>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.app-sidebar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 24px;
  min-height: 64px;
}

.app-sidebar__emoji {
  font-size: 24px;
}

.app-sidebar__name {
  font-size: 18px;
  white-space: nowrap;
  letter-spacing: 0;
}

.app-sidebar--desktop .app-sidebar__brand {
  padding: 18px 18px 16px;
}

.app-sidebar__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: #fff;
  background: linear-gradient(180deg, #2f80ed 0%, #1463d8 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 6px 16px rgba(20, 99, 216, 0.2);
  font-size: 15px;
  font-weight: 750;
  line-height: 1;
}

.app-sidebar--desktop .app-sidebar__name {
  color: var(--desktop-text-primary);
  font-size: 15px;
  font-weight: 650;
}

.app-sidebar--desktop :deep(.n-menu) {
  padding: 4px 10px 18px;
}

.app-sidebar--desktop :deep(.n-menu-item-content) {
  height: 34px;
  border-radius: 9px;
  padding-left: 10px !important;
  color: var(--desktop-text-primary);
}

.app-sidebar--desktop :deep(.n-menu-item-content:hover) {
  background: var(--desktop-sidebar-hover);
}

.app-sidebar--desktop :deep(.n-menu-item-content--selected) {
  background: var(--desktop-sidebar-selected);
  color: var(--desktop-text-primary);
  font-weight: 650;
}

.app-sidebar--desktop :deep(.n-menu-item-group-title) {
  padding: 13px 10px 5px;
  color: var(--desktop-text-tertiary);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0;
}

.app-sidebar--desktop.app-sidebar--collapsed :deep(.n-menu) {
  padding-inline: 8px;
}

.app-sidebar--desktop.app-sidebar--collapsed :deep(.n-menu-item-group-title) {
  display: none;
}

.app-sidebar--desktop.app-sidebar--collapsed :deep(.n-menu-item-content) {
  justify-content: center;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
</style>
