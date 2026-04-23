package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const miniMaxCnBaseURL = "https://api.minimaxi.com/anthropic"

type docsPiModelsConfig struct {
	Providers map[string]docsPiModelProviderConfig `json:"providers"`
}

type docsPiModelProviderConfig struct {
	BaseURL        string                                     `json:"baseUrl"`
	API            string                                     `json:"api"`
	APIKey         string                                     `json:"apiKey"`
	AuthHeader     bool                                       `json:"authHeader"`
	ModelOverrides map[string]docsPiModelOverrideCapabilities `json:"modelOverrides"`
}

type docsPiModelOverrideCapabilities struct {
	Reasoning bool `json:"reasoning"`
}

func ensureDocsPiModelsConfig(agentDir string) error {
	modelsPath := filepath.Join(agentDir, "models.json")
	if docsPiProvider() != defaultMiniMaxProvider {
		return removeDocsPiManagedModelsConfig(modelsPath)
	}
	baseURL, apiKeyEnv, ok := resolveMiniMaxManagedProviderConfig()
	if !ok {
		return removeDocsPiManagedModelsConfig(modelsPath)
	}
	model := docsPiModel()

	config := docsPiModelsConfig{
		Providers: map[string]docsPiModelProviderConfig{
			defaultMiniMaxProvider: {
				BaseURL:    baseURL,
				API:        "anthropic-messages",
				APIKey:     apiKeyEnv,
				AuthHeader: true,
				ModelOverrides: map[string]docsPiModelOverrideCapabilities{
					defaultMiniMaxModel:      {Reasoning: true},
					"MiniMax-M2.7-highspeed": {Reasoning: true},
					model:                    {Reasoning: true},
				},
			},
		},
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(modelsPath, data, 0o600)
}

func resolveMiniMaxManagedProviderConfig() (baseURL string, apiKeyEnv string, ok bool) {
	customBaseURL := strings.TrimSpace(os.Getenv(envMiniMaxBaseURL))
	hasCnKey := strings.TrimSpace(os.Getenv(envMiniMaxCnAPIKey)) != ""
	hasGlobalKey := strings.TrimSpace(os.Getenv(envMiniMaxAPIKey)) != ""
	if customBaseURL != "" {
		if hasGlobalKey {
			return customBaseURL, envMiniMaxAPIKey, true
		}
		if hasCnKey {
			return customBaseURL, envMiniMaxCnAPIKey, true
		}
		return "", "", false
	}
	if hasCnKey {
		return miniMaxCnBaseURL, envMiniMaxCnAPIKey, true
	}
	return "", "", false
}

func removeDocsPiManagedModelsConfig(modelsPath string) error {
	data, err := os.ReadFile(modelsPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	raw := string(data)
	if isDocsPiManagedMiniMaxModelsConfig(raw) {
		return os.Remove(modelsPath)
	}
	return nil
}

func isDocsPiManagedMiniMaxModelsConfig(raw string) bool {
	return strings.Contains(raw, "\""+defaultMiniMaxProvider+"\"") &&
		strings.Contains(raw, "\"anthropic-messages\"") &&
		(strings.Contains(raw, "\""+envMiniMaxCnAPIKey+"\"") ||
			strings.Contains(raw, "\""+envMiniMaxAPIKey+"\""))
}
