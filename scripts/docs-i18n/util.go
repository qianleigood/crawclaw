package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	workflowVersion          = 15
	docsI18nEngineName       = "pi"
	envDocsI18nProvider      = "CRAWCLAW_DOCS_I18N_PROVIDER"
	envDocsI18nModel         = "CRAWCLAW_DOCS_I18N_MODEL"
	envMiniMaxAPIKey         = "MINIMAX_API_KEY"
	envMiniMaxCnAPIKey       = "MINIMAX_CN_API_KEY"
	envMiniMaxBaseURL        = "MINIMAX_BASE_URL"
	envMiniMaxModel          = "MINIMAX_MODEL"
	defaultMiniMaxProvider   = "minimax"
	defaultMiniMaxModel      = "MiniMax-M2.7"
	defaultOpenAIModel       = "gpt-5.4"
	defaultAnthropicModel    = "claude-opus-4-6"
	defaultFallbackProvider  = defaultMiniMaxProvider
	defaultFallbackModelName = defaultMiniMaxModel
)

func cacheNamespace() string {
	return fmt.Sprintf(
		"wf=%d|engine=%s|provider=%s|model=%s",
		workflowVersion,
		docsI18nEngineName,
		docsPiProvider(),
		docsPiModel(),
	)
}

func cacheKey(namespace, srcLang, tgtLang, segmentID, textHash string) string {
	raw := fmt.Sprintf("%s|%s|%s|%s|%s", namespace, srcLang, tgtLang, segmentID, textHash)
	hash := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(hash[:])
}

func hashText(text string) string {
	normalized := normalizeText(text)
	hash := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(hash[:])
}

func hashBytes(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func normalizeText(text string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
}

func docsPiProvider() string {
	if value := strings.TrimSpace(os.Getenv(envDocsI18nProvider)); value != "" {
		return value
	}
	if strings.TrimSpace(os.Getenv(envMiniMaxCnAPIKey)) != "" ||
		strings.TrimSpace(os.Getenv(envMiniMaxAPIKey)) != "" {
		return defaultMiniMaxProvider
	}
	if strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != "" {
		return "openai"
	}
	if strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")) != "" {
		return "anthropic"
	}
	return defaultFallbackProvider
}

func docsPiModel() string {
	if value := strings.TrimSpace(os.Getenv(envDocsI18nModel)); value != "" {
		return value
	}
	switch docsPiProvider() {
	case "anthropic":
		return defaultAnthropicModel
	case defaultMiniMaxProvider:
		if value := strings.TrimSpace(os.Getenv(envMiniMaxModel)); value != "" {
			return value
		}
		return defaultMiniMaxModel
	case "openai":
		return defaultOpenAIModel
	default:
		return defaultFallbackModelName
	}
}

func segmentID(relPath, textHash string) string {
	shortHash := textHash
	if len(shortHash) > 16 {
		shortHash = shortHash[:16]
	}
	return fmt.Sprintf("%s:%s", relPath, shortHash)
}

func splitWhitespace(text string) (string, string, string) {
	if text == "" {
		return "", "", ""
	}
	start := 0
	for start < len(text) && isWhitespace(text[start]) {
		start++
	}
	end := len(text)
	for end > start && isWhitespace(text[end-1]) {
		end--
	}
	return text[:start], text[start:end], text[end:]
}

func isWhitespace(b byte) bool {
	switch b {
	case ' ', '\t', '\n', '\r':
		return true
	default:
		return false
	}
}

func fatal(err error) {
	if err == nil {
		return
	}
	_, _ = io.WriteString(os.Stderr, err.Error()+"\n")
	os.Exit(1)
}
