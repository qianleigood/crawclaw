export const BUNDLED_PLUGIN_ROOT_DIR = "extensions";
export const BUNDLED_PLUGIN_PATH_PREFIX = `${BUNDLED_PLUGIN_ROOT_DIR}/`;

export function bundledPluginRoot(pluginId) {
  return `${BUNDLED_PLUGIN_PATH_PREFIX}${pluginId}`;
}

export function bundledPluginFile(pluginId, relativePath) {
  return `${bundledPluginRoot(pluginId)}/${relativePath}`;
}

export function bundledDistPluginRoot(pluginId) {
  return `dist/${bundledPluginRoot(pluginId)}`;
}

export function bundledDistPluginFile(pluginId, relativePath) {
  return `${bundledDistPluginRoot(pluginId)}/${relativePath}`;
}

export function bundledPluginCallsite(pluginId, relativePath, line) {
  return `${bundledPluginFile(pluginId, relativePath)}:${line}`;
}
