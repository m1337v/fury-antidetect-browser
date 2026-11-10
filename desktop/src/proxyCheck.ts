// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

/** A check belongs to a saved proxy in one store. The same UUID can exist in
 *  the local database and on a team server, so the origin is part of its key. */
export type ProxyCheckState = {
  state: "checking" | "ok" | "error";
  ms?: number;
  error?: string;
};

export const proxyCheckKey = (origin: "local" | "team", id: string) => `${origin}:${id}`;
