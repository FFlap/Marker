import { defineConfig } from "wxt";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { resolveExtensionBuild } from "./build-config";

export default defineConfig({
  vite: () => ({
    plugins: [react()],
  }),
  manifest: ({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "WXT_");
    const build = resolveExtensionBuild(mode, { ...env, ...process.env });

    return {
      key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSlsyTH7ozsWTOXKx6lF3y6MXe3pzSV8zea0ZK1FIWhkFwu+FPV9zYtfLfl4yPos9AVBCxG+ofSLHmKW1BeAmkFJmfvLMY2XdeSLLGhX4MJ7mM48zF43j3fgkviY3hNBNhI+A3Y0cIgIWbwY5p6ucLcDXfiU9Ve8/GYEHryhHfZkYowTHSwlehiGKrU+YyT9xJeYvplMXzJJ/GtHL/qE0o0dW6jRxZvHowImtXHcab74gU/rM5MBadhqfy/PPTGoIaYM3C6v5nOURoAYioYQitIN+kXrYxYbJN6yPcesBAy/DIr7jgxhawBgE8e5ghP499SUgO0Soz5SJtx/UrSboQIDAQAB",
      name: "Marker",
      description:
        "Automatically remember the latest episode opened on Crunchyroll and Netflix.",
      permissions: ["storage", "tabs", "alarms", "cookies"],
      host_permissions: build.hostPermissions,
      icons: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
      action: {
        default_icon: {
          16: "icon/16.png",
          32: "icon/32.png",
          48: "icon/48.png",
          128: "icon/128.png",
        },
      },
    };
  },
});
