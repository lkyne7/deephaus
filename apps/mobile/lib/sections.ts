import { router, type Href } from "expo-router";

/** The bits of the sidebar's drawer navigator that switching areas needs. */
type DrawerHandle = {
  navigate: (name: string, params?: object) => void;
  dispatch: (action: { type: string; target?: string }) => void;
  getState: () => {
    routes: readonly {
      name: string;
      state?: {
        key?: string;
        index?: number;
        routes?: readonly { name: string; params?: object }[];
      };
    }[];
  };
};

let drawer: DrawerHandle | null = null;

/** The sidebar registers its drawer here while it's mounted. */
export function registerSectionDrawer(handle: DrawerHandle | null) {
  drawer = handle;
}

/**
 * Opens one of the app's areas at its top screen, like tapping a tab you're
 * already on: whatever detail screens that area still has open are popped,
 * so no second copy of its list stacks on top of them. `params` reach the
 * area's index screen (Home's deck, task or fresh start).
 */
export function openSection(name: string, params?: Record<string, string>) {
  if (!drawer) {
    router.navigate((params ? { pathname: `/${name}`, params } : `/${name}`) as Href);
    return;
  }
  const stack = drawer.getState().routes.find((route) => route.name === name)?.state;
  if (stack?.key && (stack.index ?? 0) > 0) {
    drawer.dispatch({ type: "POP_TO_TOP", target: stack.key });
  }
  drawer.navigate(name, { screen: "index", params });
}

/**
 * Opens a deck's page on top of the Decks list, so Back always has a list to
 * return to. If that deck is already the open page in Decks, it just goes there
 * rather than stacking a second copy.
 */
export function openDeck(deckId: string) {
  const stack = drawer?.getState().routes.find((route) => route.name === "decks")?.state;
  const top = stack?.routes?.[stack.index ?? 0];
  if (drawer && top?.name === "[deckId]" && (top.params as { deckId?: string } | undefined)?.deckId === deckId) {
    drawer.navigate("decks");
    return;
  }
  router.push(`/decks/${deckId}`, { withAnchor: true });
}
