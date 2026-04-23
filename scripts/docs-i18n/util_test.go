package main

import "testing"

func TestDocsPiProviderPrefersExplicitOverride(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "anthropic")
	t.Setenv("OPENAI_API_KEY", "openai-key")
	t.Setenv("ANTHROPIC_API_KEY", "anthropic-key")

	if got := docsPiProvider(); got != "anthropic" {
		t.Fatalf("expected anthropic override, got %q", got)
	}
}

func TestDocsPiProviderPrefersOpenAIEnvWhenAvailable(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "")
	t.Setenv("MINIMAX_API_KEY", "")
	t.Setenv("MINIMAX_CN_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "openai-key")
	t.Setenv("ANTHROPIC_API_KEY", "anthropic-key")

	if got := docsPiProvider(); got != "openai" {
		t.Fatalf("expected openai provider, got %q", got)
	}
}

func TestDocsPiProviderPrefersMiniMaxEnvWhenAvailable(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "")
	t.Setenv("MINIMAX_CN_API_KEY", "minimax-cn-key")
	t.Setenv("OPENAI_API_KEY", "openai-key")
	t.Setenv("ANTHROPIC_API_KEY", "anthropic-key")

	if got := docsPiProvider(); got != "minimax" {
		t.Fatalf("expected minimax provider, got %q", got)
	}
}

func TestDocsPiProviderFallsBackToMiniMax(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "")
	t.Setenv("MINIMAX_API_KEY", "")
	t.Setenv("MINIMAX_CN_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")

	if got := docsPiProvider(); got != "minimax" {
		t.Fatalf("expected minimax fallback provider, got %q", got)
	}
}

func TestDocsPiModelUsesProviderDefault(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "anthropic")
	t.Setenv(envDocsI18nModel, "")

	if got := docsPiModel(); got != defaultAnthropicModel {
		t.Fatalf("expected anthropic default model, got %q", got)
	}
}

func TestDocsPiModelKeepsOpenAIDefaultAtGPT54(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "openai")
	t.Setenv(envDocsI18nModel, "")

	if got := docsPiModel(); got != defaultOpenAIModel {
		t.Fatalf("expected OpenAI default model %q, got %q", defaultOpenAIModel, got)
	}
}

func TestDocsPiModelKeepsMiniMaxDefaultAtM27(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "minimax")
	t.Setenv(envDocsI18nModel, "")
	t.Setenv(envMiniMaxModel, "")

	if got := docsPiModel(); got != defaultMiniMaxModel {
		t.Fatalf("expected MiniMax default model %q, got %q", defaultMiniMaxModel, got)
	}
}

func TestDocsPiModelUsesMiniMaxModelEnvForMiniMax(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "minimax")
	t.Setenv(envDocsI18nModel, "")
	t.Setenv(envMiniMaxModel, "MiniMax-M2.7-highspeed")

	if got := docsPiModel(); got != "MiniMax-M2.7-highspeed" {
		t.Fatalf("expected MiniMax model env override, got %q", got)
	}
}

func TestDocsPiModelPrefersExplicitOverride(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "openai")
	t.Setenv(envDocsI18nModel, "gpt-5.2")
	t.Setenv(envMiniMaxModel, "MiniMax-M2.7-highspeed")

	if got := docsPiModel(); got != "gpt-5.2" {
		t.Fatalf("expected explicit model override, got %q", got)
	}
}
