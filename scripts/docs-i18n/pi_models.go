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
	if docsPiProvider() != defaultMiniMaxProvider ||
		strings.TrimSpace(os.Getenv(envMiniMaxCnAPIKey)) == "" {
		return removeDocsPiManagedModelsConfig(modelsPath)
	}

	config := docsPiModelsConfig{
		Providers: map[string]docsPiModelProviderConfig{
			defaultMiniMaxProvider: {
				BaseURL:    miniMaxCnBaseURL,
				API:        "anthropic-messages",
				APIKey:     envMiniMaxCnAPIKey,
				AuthHeader: true,
				ModelOverrides: map[string]docsPiModelOverrideCapabilities{
					defaultMiniMaxModel:      {Reasoning: true},
					"MiniMax-M2.7-highspeed": {Reasoning: true},
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

func removeDocsPiManagedModelsConfig(modelsPath string) error {
	data, err := os.ReadFile(modelsPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	raw := string(data)
	if strings.Contains(raw, miniMaxCnBaseURL) && strings.Contains(raw, envMiniMaxCnAPIKey) {
		return os.Remove(modelsPath)
	}
	return nil
}
