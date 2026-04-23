package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakePromptRunner struct {
	prompt func(context.Context, string) (string, error)
	stderr string
}

func (runner fakePromptRunner) Prompt(ctx context.Context, message string) (string, error) {
	return runner.prompt(ctx, message)
}

func (runner fakePromptRunner) Stderr() string {
	return runner.stderr
}

func TestRunPromptAddsTimeout(t *testing.T) {
	t.Parallel()

	var deadline time.Time
	client := fakePromptRunner{
		prompt: func(ctx context.Context, message string) (string, error) {
			var ok bool
			deadline, ok = ctx.Deadline()
			if !ok {
				t.Fatal("expected prompt deadline")
			}
			if message != "Translate me" {
				t.Fatalf("unexpected message %q", message)
			}
			return "translated", nil
		},
	}

	got, err := runPrompt(context.Background(), client, "Translate me")
	if err != nil {
		t.Fatalf("runPrompt returned error: %v", err)
	}
	if got != "translated" {
		t.Fatalf("unexpected translation %q", got)
	}

	remaining := time.Until(deadline)
	if remaining <= time.Minute || remaining > docsI18nPromptTimeout() {
		t.Fatalf("unexpected timeout window %s", remaining)
	}
}

func TestDocsI18nPromptTimeoutUsesEnvOverride(t *testing.T) {
	t.Setenv(envDocsI18nPromptTimeout, "5m")

	if got := docsI18nPromptTimeout(); got != 5*time.Minute {
		t.Fatalf("expected 5m timeout, got %s", got)
	}
}

func TestIsRetryableTranslateErrorRejectsDeadlineExceeded(t *testing.T) {
	t.Parallel()

	if isRetryableTranslateError(context.DeadlineExceeded) {
		t.Fatal("deadline exceeded should not retry")
	}
}

func TestIsRetryableTranslateErrorRejectsAuthenticationFailures(t *testing.T) {
	t.Parallel()

	if isRetryableTranslateError(errors.New(`Authentication failed for "openai"`)) {
		t.Fatal("auth failures should not retry")
	}
}

func TestRunPromptIncludesStderr(t *testing.T) {
	t.Parallel()

	rootErr := errors.New("context deadline exceeded")
	client := fakePromptRunner{
		prompt: func(context.Context, string) (string, error) {
			return "", rootErr
		},
		stderr: "boom",
	}

	_, err := runPrompt(context.Background(), client, "Translate me")
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, rootErr) {
		t.Fatalf("expected wrapped root error, got %v", err)
	}
	if !strings.Contains(err.Error(), "pi stderr: boom") {
		t.Fatalf("expected stderr in error, got %v", err)
	}
}

func TestDecoratePromptErrorLeavesCleanErrorsAlone(t *testing.T) {
	t.Parallel()

	rootErr := errors.New("plain failure")
	got := decoratePromptError(rootErr, "  ")
	if !errors.Is(got, rootErr) {
		t.Fatalf("expected original error, got %v", got)
	}
	if got.Error() != rootErr.Error() {
		t.Fatalf("expected unchanged message, got %v", got)
	}
}

func TestNormalizeThinkingAllowsPiThinkingLevels(t *testing.T) {
	for _, level := range []string{"off", "minimal", "low", "medium", "high", "xhigh"} {
		if got := normalizeThinking(level); got != level {
			t.Fatalf("expected thinking level %q, got %q", level, got)
		}
	}
}

func TestNormalizeThinkingDefaultsToOff(t *testing.T) {
	if got := normalizeThinking("unexpected"); got != defaultDocsI18nThinking {
		t.Fatalf("expected default thinking %q, got %q", defaultDocsI18nThinking, got)
	}
}

func TestResolveDocsPiCommandUsesOverrideEnv(t *testing.T) {
	t.Setenv(envDocsPiExecutable, "/tmp/custom-pi")
	t.Setenv(envDocsPiArgs, "--mode rpc --foo bar")

	command, err := resolveDocsPiCommand(context.Background())
	if err != nil {
		t.Fatalf("resolveDocsPiCommand returned error: %v", err)
	}

	if command.Executable != "/tmp/custom-pi" {
		t.Fatalf("unexpected executable %q", command.Executable)
	}
	if strings.Join(command.Args, " ") != "--mode rpc --foo bar" {
		t.Fatalf("unexpected args %v", command.Args)
	}
}

func TestMaterializedPiRuntimeDefaultsToCurrentPi(t *testing.T) {
	t.Setenv(envDocsPiPackageVersion, "")

	if got := getMaterializedPiPackageVersion(); got != "0.68.0" {
		t.Fatalf("expected materialized Pi runtime 0.68.0, got %q", got)
	}
}

func TestMaterializedPiRuntimeInstallArgsUsePrefix(t *testing.T) {
	args := materializedPiRuntimeInstallArgs("/tmp/crawclaw-pi-runtime", "0.68.0")
	joined := strings.Join(args, " ")

	if !strings.Contains(joined, "--prefix /tmp/crawclaw-pi-runtime") {
		t.Fatalf("expected npm install args to pin prefix, got %v", args)
	}
	if args[len(args)-1] != "@mariozechner/pi-coding-agent@0.68.0" {
		t.Fatalf("expected package spec last, got %v", args)
	}
}

func TestEnsureDocsPiModelsConfigWritesMiniMaxCnProviderWithoutSecret(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "minimax")
	t.Setenv(envMiniMaxCnAPIKey, "secret-value")
	t.Setenv(envMiniMaxBaseURL, "")
	t.Setenv(envMiniMaxModel, "")

	dir := t.TempDir()
	if err := ensureDocsPiModelsConfig(dir); err != nil {
		t.Fatalf("ensureDocsPiModelsConfig returned error: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "models.json"))
	if err != nil {
		t.Fatalf("read models.json: %v", err)
	}
	raw := string(data)
	if strings.Contains(raw, "secret-value") {
		t.Fatalf("models.json must reference env names, not write secret values: %s", raw)
	}

	var config struct {
		Providers map[string]struct {
			BaseURL        string `json:"baseUrl"`
			API            string `json:"api"`
			APIKey         string `json:"apiKey"`
			AuthHeader     bool   `json:"authHeader"`
			ModelOverrides map[string]struct {
				Reasoning bool `json:"reasoning"`
			} `json:"modelOverrides"`
		} `json:"providers"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatalf("decode models.json: %v", err)
	}
	provider, ok := config.Providers["minimax"]
	if !ok {
		t.Fatalf("expected minimax provider config, got %v", config.Providers)
	}
	if provider.BaseURL != miniMaxCnBaseURL {
		t.Fatalf("unexpected MiniMax CN base URL %q", provider.BaseURL)
	}
	if provider.API != "anthropic-messages" {
		t.Fatalf("unexpected MiniMax API %q", provider.API)
	}
	if provider.APIKey != envMiniMaxCnAPIKey {
		t.Fatalf("expected apiKey env reference %q, got %q", envMiniMaxCnAPIKey, provider.APIKey)
	}
	if !provider.AuthHeader {
		t.Fatal("expected authHeader=true for MiniMax CN")
	}
	if !provider.ModelOverrides[defaultMiniMaxModel].Reasoning {
		t.Fatalf("expected reasoning override for %s", defaultMiniMaxModel)
	}
}

func TestEnsureDocsPiModelsConfigSkipsWithoutMiniMaxCnKey(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "minimax")
	t.Setenv(envMiniMaxCnAPIKey, "")
	t.Setenv(envMiniMaxAPIKey, "")
	t.Setenv(envMiniMaxBaseURL, "")

	dir := t.TempDir()
	if err := ensureDocsPiModelsConfig(dir); err != nil {
		t.Fatalf("ensureDocsPiModelsConfig returned error: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "models.json")); !os.IsNotExist(err) {
		t.Fatalf("expected models.json to be skipped, got err=%v", err)
	}
}

func TestEnsureDocsPiModelsConfigRemovesManagedCustomProviderWithoutKey(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "minimax")
	t.Setenv(envMiniMaxCnAPIKey, "")
	t.Setenv(envMiniMaxAPIKey, "")
	t.Setenv(envMiniMaxBaseURL, "")

	dir := t.TempDir()
	modelsPath := filepath.Join(dir, "models.json")
	data := []byte(`{
  "providers": {
    "minimax": {
      "baseUrl": "https://custom.minimax.example/anthropic",
      "api": "anthropic-messages",
      "apiKey": "MINIMAX_API_KEY",
      "authHeader": true
    }
  }
}
`)
	if err := os.WriteFile(modelsPath, data, 0o600); err != nil {
		t.Fatalf("write models.json: %v", err)
	}

	if err := ensureDocsPiModelsConfig(dir); err != nil {
		t.Fatalf("ensureDocsPiModelsConfig returned error: %v", err)
	}
	if _, err := os.Stat(modelsPath); !os.IsNotExist(err) {
		t.Fatalf("expected managed models.json to be removed, got err=%v", err)
	}
}

func TestEnsureDocsPiModelsConfigWritesMiniMaxCustomProviderWithoutSecret(t *testing.T) {
	t.Setenv(envDocsI18nProvider, "minimax")
	t.Setenv(envDocsI18nModel, "")
	t.Setenv(envMiniMaxCnAPIKey, "")
	t.Setenv(envMiniMaxAPIKey, "secret-value")
	t.Setenv(envMiniMaxBaseURL, "https://custom.minimax.example/anthropic")
	t.Setenv(envMiniMaxModel, "MiniMax-M2.7-highspeed")

	dir := t.TempDir()
	if err := ensureDocsPiModelsConfig(dir); err != nil {
		t.Fatalf("ensureDocsPiModelsConfig returned error: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "models.json"))
	if err != nil {
		t.Fatalf("read models.json: %v", err)
	}
	raw := string(data)
	if strings.Contains(raw, "secret-value") {
		t.Fatalf("models.json must reference env names, not write secret values: %s", raw)
	}

	var config struct {
		Providers map[string]struct {
			BaseURL        string `json:"baseUrl"`
			API            string `json:"api"`
			APIKey         string `json:"apiKey"`
			AuthHeader     bool   `json:"authHeader"`
			ModelOverrides map[string]struct {
				Reasoning bool `json:"reasoning"`
			} `json:"modelOverrides"`
		} `json:"providers"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatalf("decode models.json: %v", err)
	}
	provider, ok := config.Providers["minimax"]
	if !ok {
		t.Fatalf("expected minimax provider config, got %v", config.Providers)
	}
	if provider.BaseURL != "https://custom.minimax.example/anthropic" {
		t.Fatalf("unexpected MiniMax base URL %q", provider.BaseURL)
	}
	if provider.APIKey != envMiniMaxAPIKey {
		t.Fatalf("expected apiKey env reference %q, got %q", envMiniMaxAPIKey, provider.APIKey)
	}
	if !provider.ModelOverrides["MiniMax-M2.7-highspeed"].Reasoning {
		t.Fatalf("expected reasoning override for custom MiniMax model")
	}
}

func TestShouldMaterializePiRuntimeForPiMonoWrapper(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	sourceDir := filepath.Join(root, "Projects", "pi-mono", "packages", "coding-agent", "dist")
	binDir := filepath.Join(root, "bin")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatalf("mkdir source dir: %v", err)
	}
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin dir: %v", err)
	}

	target := filepath.Join(sourceDir, "cli.js")
	if err := os.WriteFile(target, []byte("console.log('pi');\n"), 0o644); err != nil {
		t.Fatalf("write target: %v", err)
	}
	link := filepath.Join(binDir, "pi")
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	if !shouldMaterializePiRuntime(link) {
		t.Fatal("expected pi-mono wrapper to materialize runtime")
	}
}
