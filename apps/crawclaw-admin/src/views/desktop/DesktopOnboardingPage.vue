<script setup lang="ts">
import { NButton, NCard, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useDesktopStore } from '@/stores/desktop'

const router = useRouter()
const desktopStore = useDesktopStore()
const { t } = useI18n()

function start() {
  desktopStore.completeOnboarding()
  router.push({ name: 'Chat' })
}

function goTo(name: string) {
  desktopStore.completeOnboarding()
  router.push({ name })
}

function enableAdvancedMode() {
  desktopStore.setAdvancedMode(true)
  desktopStore.completeOnboarding()
  router.push({ name: 'Settings' })
}
</script>

<template>
  <div class="desktop-onboarding">
    <NCard class="desktop-onboarding__panel" :bordered="false">
      <div class="desktop-onboarding__assistant">
        <div class="desktop-onboarding__app-icon" aria-hidden="true">C</div>
        <div class="desktop-onboarding__copy">
          <div class="desktop-onboarding__eyebrow">CrawClaw Desktop</div>
          <h1>{{ t('pages.desktopOnboarding.title') }}</h1>
          <p>{{ t('pages.desktopOnboarding.subtitle') }}</p>
        </div>
      </div>

      <div class="desktop-onboarding__actions">
        <NButton type="primary" size="large" class="desktop-onboarding__button" @click="start">
          {{ t('pages.desktopOnboarding.start') }}
        </NButton>
        <NButton size="large" secondary @click="goTo('Models')">
          {{ t('pages.desktopOnboarding.chooseModel') }}
        </NButton>
        <NButton size="large" secondary @click="goTo('Channels')">
          {{ t('pages.desktopOnboarding.connectChannels') }}
        </NButton>
      </div>

      <div class="desktop-onboarding__steps">
        <button type="button" class="desktop-onboarding__step" @click="start">
          <NText strong>{{ t('pages.desktopOnboarding.localTitle') }}</NText>
          <NText depth="3">{{ t('pages.desktopOnboarding.localText') }}</NText>
        </button>
        <button type="button" class="desktop-onboarding__step" @click="goTo('Models')">
          <NText strong>{{ t('pages.desktopOnboarding.modelTitle') }}</NText>
          <NText depth="3">{{ t('pages.desktopOnboarding.modelText') }}</NText>
        </button>
        <button type="button" class="desktop-onboarding__step" @click="enableAdvancedMode">
          <NText strong>{{ t('pages.desktopOnboarding.simpleTitle') }}</NText>
          <NText depth="3">{{ t('pages.desktopOnboarding.simpleText') }}</NText>
        </button>
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.desktop-onboarding {
  min-height: calc(100vh - var(--desktop-toolbar-height) - 40px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.desktop-onboarding__panel {
  width: min(820px, 100%);
}

.desktop-onboarding__assistant {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 22px;
  align-items: center;
  padding: 18px 8px 22px;
}

.desktop-onboarding__app-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 74px;
  height: 74px;
  border-radius: 20px;
  color: #fff;
  background: linear-gradient(180deg, #2f80ed 0%, #1463d8 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 14px 36px rgba(20, 99, 216, 0.24);
  font-size: 36px;
  font-weight: 760;
}

.desktop-onboarding__eyebrow {
  margin-bottom: 8px;
  color: var(--desktop-text-secondary);
  font-size: 13px;
  font-weight: 650;
}

.desktop-onboarding__copy h1 {
  margin: 0;
  color: var(--desktop-text-primary);
  font-size: 30px;
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: 0;
}

.desktop-onboarding__copy p {
  max-width: 580px;
  margin: 10px 0 0;
  color: var(--desktop-text-secondary);
  font-size: 15px;
  line-height: 1.6;
}

.desktop-onboarding__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 0 8px 18px;
}

.desktop-onboarding__button {
  min-width: 152px;
}

.desktop-onboarding__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.desktop-onboarding__step {
  min-height: 118px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 16px;
  border: 1px solid var(--desktop-border);
  border-radius: 14px;
  background: var(--bg-primary);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.16s ease, border-color 0.16s ease;
}

.desktop-onboarding__step:hover {
  background: color-mix(in srgb, var(--desktop-accent) 6%, var(--bg-primary));
  border-color: color-mix(in srgb, var(--desktop-accent) 32%, var(--desktop-border));
}

@media (max-width: 820px) {
  .desktop-onboarding__assistant {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }

  .desktop-onboarding__steps {
    grid-template-columns: 1fr;
  }
}
</style>
