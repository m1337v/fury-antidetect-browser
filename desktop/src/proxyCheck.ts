// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

/** A check belongs to a saved proxy in one store. The same UUID can exist in
 *  the local database and on a team server, so the origin is part of its key. */
export type ProxyCheckState = {
  state: "checking" | "ok" | "error";
  ms?: number;
  error?: string;
};

/** Rotation asks the provider to issue a new exit. It intentionally does not
 *  claim that the exit changed: only a later manual check can establish that. */
export type ProxyRotationState = {
  state: "rotating" | "ok" | "error";
  /** The provider accepted the request, but row metadata is still refreshing. */
  accepted?: boolean;
  error?: string;
};

export const proxyCheckKey = (origin: "local" | "team", id: string) => `${origin}:${id}`;
