import { app, Menu, shell, type MenuItemConstructorOptions } from "electron";
import type { DesktopConfig } from "./config";

export interface MenuHandlers {
  navigate(appPath: string): void;
  checkForUpdates(): void;
}

/** Mirrors the sidebar in apps/web/src/components/sidebar.tsx. */
const SECTIONS: Array<{ label: string; path: string; accelerator: string }> = [
  { label: "Dashboard", path: "/dashboard", accelerator: "CmdOrCtrl+1" },
  { label: "Decks", path: "/decks", accelerator: "CmdOrCtrl+2" },
  { label: "Cards", path: "/cards", accelerator: "CmdOrCtrl+3" },
  { label: "Exams", path: "/exams", accelerator: "CmdOrCtrl+4" },
  { label: "Community", path: "/community", accelerator: "CmdOrCtrl+5" },
];

export function installMenu(config: DesktopConfig, handlers: MenuHandlers): void {
  const isMac = process.platform === "darwin";

  const appMenu: MenuItemConstructorOptions = {
    label: config.productName,
    submenu: [
      { role: "about" },
      { label: "Check for Updates…", click: () => handlers.checkForUpdates() },
      { type: "separator" },
      { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => handlers.navigate("/settings/account") },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      { label: "New Deck", accelerator: "CmdOrCtrl+N", click: () => handlers.navigate("/create") },
      { label: "Import…", accelerator: "CmdOrCtrl+Shift+I", click: () => handlers.navigate("/create/import") },
      { type: "separator" },
      ...(isMac
        ? [{ role: "close" } as MenuItemConstructorOptions]
        : [
            { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => handlers.navigate("/settings/account") },
            { label: "Check for Updates…", click: () => handlers.checkForUpdates() },
            { type: "separator" } as MenuItemConstructorOptions,
            { role: "quit" } as MenuItemConstructorOptions,
          ]),
    ],
  };

  const studyMenu: MenuItemConstructorOptions = {
    label: "Study",
    submenu: [
      { label: "Review Due Cards", accelerator: "CmdOrCtrl+R", click: () => handlers.navigate("/review") },
      { type: "separator" },
      ...SECTIONS.map<MenuItemConstructorOptions>((section) => ({
        label: section.label,
        accelerator: section.accelerator,
        click: () => handlers.navigate(section.path),
      })),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "reload", accelerator: "CmdOrCtrl+Shift+R" },
      ...(app.isPackaged ? [] : [{ role: "toggleDevTools" } as MenuItemConstructorOptions]),
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      { label: "DeepHaus Website", click: () => void shell.openExternal(config.origin) },
      { label: "Support", click: () => void shell.openExternal(`${config.origin}/support`) },
      { label: "Release Notes", click: () => void shell.openExternal("https://github.com/lkyne7/deephaus/releases") },
      ...(isMac ? [] : [{ type: "separator" } as MenuItemConstructorOptions, { role: "about" } as MenuItemConstructorOptions]),
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    { role: "editMenu" },
    studyMenu,
    viewMenu,
    { role: "windowMenu" },
    helpMenu,
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
