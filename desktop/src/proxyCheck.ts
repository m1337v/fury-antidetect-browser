// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

/** A manual observation wins over metadata read before a rotation. `null`
 * means a rotation was accepted, so the old exit remains hidden until checked. */
export type ProxyExit = {
  ip?: string;
  country?: string;
  timezone?: string;
};

/** A saved proxy is shared by profile and proxy rows, so its current action
 * and observation live under one store-qualified key. */
export type ProxyOperation = {
  action: "check" | "rotate";
  status: "pending" | "ok" | "error";
  exit?: ProxyExit | null;
  ms?: number;
  error?: string;
};

export const proxyCheckKey = (origin: "local" | "team", id: string) => `${origin}:${id}`;
