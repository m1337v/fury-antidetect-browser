// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import { Icon, IconButton } from "./Icon";
import { useCallback, useEffect, useState } from "react";
import { api, type LocalProxy, type Profile } from "../api";
import { flag } from "../flag";
import { useI18n } from "../i18n";
import { useAsk } from "./Ask";
import { ProxyForm, addedByMe, proxyLock } from "./ProxyForm";
import { ProxyPaste } from "./ProxyPaste";
import { PartnerCard } from "./Partner";
import type { ProxyCheckState, ProxyRotationState } from "../proxyCheck";

/** The proxies this machine knows about.
 *
 *  A section rather than a list buried in the profile editor, because an exit
 *  outlives the profile that first needed it: the same residential IP carries
 *  three accounts, and the place to see that is here — the "used by" column is
 *  the one number that matters, since several accounts behind one address is
 *  the oldest farm signal there is. */
export function Proxies({
  profiles,
  local,
  myEmail = null,
  canCheck,
  canRotate,
  onCheckProxy,
  proxyCheckFor,
  onRotateProxy,
  proxyRotationFor,
  onProxySaved,
}: {
  profiles: Profile[];
  local: boolean;
  myEmail?: string | null;
  /** Team proxy checks require the same organisation-wide secret permission
   *  as the sealed credential endpoint. */
  canCheck: boolean;
  /** Rotation changes a shared proxy and is therefore limited to people who
   *  may edit it, even though its saved URL is never revealed here. */
  canRotate: boolean;
  /** The parent owns checks so a profile row and this table cannot run two
   *  requests for the same saved proxy. `true` means the stored exit changed. */
  onCheckProxy: (proxy: LocalProxy) => Promise<boolean>;
  proxyCheckFor: (proxy: LocalProxy) => ProxyCheckState | undefined;
  onRotateProxy: (proxy: LocalProxy) => Promise<boolean>;
  proxyRotationFor: (proxy: LocalProxy) => ProxyRotationState | undefined;
  /** A proxy edit makes any cached row-check outcome stale. */
  onProxySaved?: (id: string) => void;
}) {
  const { t, say } = useI18n();
  const { ask, dialog } = useAsk();
  const [rows, setRows] = useState<LocalProxy[]>([]);
  const [editing, setEditing] = useState<LocalProxy | null | undefined>(undefined);
  const [pasting, setPasting] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Check all is deliberately an operator action. Its progress is separate
  // from the shared per-proxy state, so one pending row never freezes another.
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);

  /** Local proxies whose password the keychain will not open now. They read
   *  back blank, and nothing used to say so: a tester re-typed every one after
   *  an update (15.10.2026). */
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [stillLocked, setStillLocked] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.proxies());
      setError(null);
    } catch (e) {
      setError(say(e));
    }
    if (local) {
      void api.vaultStatus().then((v) => setUnreadable(v.unreadable), () => {});
    }
  }, [local]);

  useEffect(() => {
    void load();
  }, [load]);

  const runCheck = async (proxy: LocalProxy) => {
    try {
      return await onCheckProxy(proxy);
    } catch (e) {
      setError(say(e));
      return false;
    }
  };

  const checkOne = async (proxy: LocalProxy) => {
    const changed = await runCheck(proxy);
    if (changed) await load();
  };

  const runRotation = async (proxy: LocalProxy) => {
    try {
      return await onRotateProxy(proxy);
    } catch (e) {
      setError(say(e));
      return false;
    }
  };

  const rotateOne = async (proxy: LocalProxy) => {
    const rotated = await runRotation(proxy);
    if (!rotated) return;
    // The provider accepted the request, not proof that a new IP has appeared.
    // Mirror the persisted metadata clear even if the following list request
    // did not return, so this table never keeps showing the old checked exit.
    setRows((saved) => saved.map((row) => row.id === proxy.id
      ? { ...row, last_country: null, last_ip: null, last_timezone: null }
      : row));
  };

  const checkAll = async () => {
    if (!canCheck) return;
    // Do not enqueue a second request for an exit already being checked from a
    // profile row. The parent also deduplicates, this avoids misleading batch
    // progress for a request this button did not start.
    const list = rows.filter((proxy) => (
      proxyCheckFor(proxy)?.state !== "checking"
      && proxyRotationFor(proxy)?.state !== "rotating"
    ));
    if (list.length === 0) return;
    setChecking({ done: 0, total: list.length });
    let done = 0;
    let changed = false;
    // Three at a time: the checker is a third party, and forty simultaneous
    // requests from one address is how a checker starts refusing.
    const queue = [...list];
    const worker = async () => {
      for (;;) {
        const proxy = queue.shift();
        if (!proxy) return;
        changed = (await runCheck(proxy)) || changed;
        done++;
        setChecking({ done, total: list.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setChecking(null);
    if (changed) await load();
  };

  const usedBy = (id: string) => profiles.filter((p) => p.proxy?.id === id).length;
  const checkResults = rows
    .map(proxyCheckFor)
    .filter((check): check is ProxyCheckState => check?.state === "ok" || check?.state === "error");

  return (
    <>
      {dialog}
      <div className="toolbar">
        <button className="primary" onClick={() => setEditing(null)}>
          {t("px.newOne")}
        </button>
        <button onClick={() => setPasting(true)}>{t("pp.paste")}</button>
        {canCheck && rows.length > 0 && (
          <button className="ghost" disabled={checking !== null} onClick={() => void checkAll()}>
            {checking ? t("px.checkingN", { done: checking.done, total: checking.total }) : t("px.checkAll", { n: rows.length })}
          </button>
        )}
        {!checking && checkResults.length > 0 && (
          <span className="muted small">
            {t("px.checkSummary", { ok: checkResults.filter((check) => check.state === "ok").length, bad: checkResults.filter((check) => check.state === "error").length })}
          </span>
        )}
        <div className="spacer" />
        {rows.length > 0 && (
          <button className="partnerBuy" aria-expanded={shopping} onClick={() => setShopping((v) => !v)}>
            <Icon name="tag" size={14} /> {t("partner.buy")} <span className="partnerPill">{t("partner.upTo")}</span>
          </button>
        )}
        <IconButton icon="refresh" label={t("bar.refresh")} onClick={() => void load()} />
      </div>

      {error && <div className="notice warnBar">{error}</div>}
      {unreadable.length > 0 && (
        <div className="notice warnBar">
          {t("px.vaultUnreadable", { n: unreadable.length, list: unreadable.join(", ") })}
          {stillLocked && <> {t("px.vaultStillLocked")}</>}{" "}
          <button
            className="linky"
            onClick={async () => {
              const v = await api.vaultStatus(true).catch(() => null);
              setStillLocked(v !== null && v.unreadable.length > 0);
              await load();
            }}
          >
            {t("px.vaultRetry")}
          </button>
        </div>
      )}

      {shopping && rows.length > 0 && <PartnerCard onHide={() => setShopping(false)} />}

      <div className="tableWrap">
        {rows.length === 0 ? (
          <div className="pad">
            <p className="empty">{t("px.none")}</p>
            <PartnerCard />
          </div>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>{t("px.label")}</th>
                <th>{t("px.address")}</th>
                <th>{t("px.lastSeen")}</th>
                <th>{t("px.usedBy")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const check = proxyCheckFor(p);
                const rotation = proxyRotationFor(p);
                const operationPending = check?.state === "checking" || rotation?.state === "rotating";
                const exitCleared = rotation?.accepted || rotation?.state === "ok";
                const locked = proxyLock(p, myEmail, t);
                const checkLabel = check?.state === "checking" ? t("px.checking") : t("px.check");
                const checkTitle = check?.state === "ok"
                  ? t("px.checkOk", { ms: check.ms ?? 0 })
                  : check?.state === "error"
                    ? check.error ?? t("px.checkBad")
                    : checkLabel;
                const rotationLabel = rotation?.state === "rotating" ? t("px.rotating") : t("px.rotateNow");
                const rotationTitle = rotation?.state === "ok" || rotation?.accepted
                  ? t("px.rotated")
                  : rotation?.state === "error"
                    ? rotation.error ?? t("px.checkBad")
                    : rotationLabel;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="name">{p.name}</div>
                      <div className="muted small">
                        {p.kind}
                        {p.added_by && <> · {addedByMe(p, myEmail) ? t("px.addedByYou") : t("px.addedBy", { who: p.added_by })}</>}
                      </div>
                    </td>
                    <td className="mono">
                      {p.host}:{p.port}
                      {p.username && <div className="muted small">{p.username}</div>}
                    </td>
                    <td className="muted small">
                      {exitCleared ? "—" : p.last_ip ?? "—"}
                      {!exitCleared && p.last_country && (
                        <>
                          {" · "}
                          <span className="flag">{flag(p.last_country)}</span> {p.last_country}
                        </>
                      )}
                      {check && check.state !== "checking" && (check.state === "ok" ? (
                        <div className="ok">{t("px.checkOk", { ms: check.ms ?? 0 })}</div>
                      ) : (
                        <div className="warn" title={check.error}>{t("px.checkBad")}</div>
                      ))}
                      {rotation && rotation.state !== "rotating" && (rotation.state === "ok" ? (
                        <div className="ok">{t("px.rotated")}</div>
                      ) : (
                        <div className="warn" title={rotation.error}>{t("px.checkBad")}</div>
                      ))}
                    </td>
                    <td className="muted">
                      {usedBy(p.id) === 0 ? "—" : t("px.usedByN", { n: usedBy(p.id) })}
                    </td>
                    <td className="actions">
                      <div>
                      {/* Check is first because it describes the exit; editing
                          and deletion remain the table's ordinary actions. */}
                      {canCheck && (
                        <span className={`proxyTableCheck proxyCheck-${check?.state ?? "idle"}`}>
                          <IconButton
                            icon="check"
                            label={checkLabel}
                            title={checkTitle}
                            disabled={operationPending}
                            onClick={() => void checkOne(p)}
                          />
                        </span>
                      )}
                      {canRotate && p.has_rotation && locked === null && (
                        <span className={`proxyTableRotate proxyRotate-${rotation?.state ?? "idle"}`}>
                          <IconButton
                            icon="refresh"
                            label={rotationLabel}
                            title={rotationTitle}
                            disabled={operationPending}
                            onClick={() => void rotateOne(p)}
                          />
                        </span>
                      )}
                      <IconButton icon="pencil" label={t("row.edit")} onClick={() => setEditing(p)} />
                      <IconButton
                        icon="trash"
                        danger
                        label={t("row.delete")}
                        title={locked ?? undefined}
                        disabled={locked !== null}
                        onClick={async () => {
                          const go = await ask({
                            title: t("row.delete"),
                            detail: t("px.confirmDelete", { name: p.name }),
                            confirmLabel: t("ui.delete"),
                            danger: true,
                          });
                          if (go === null) return;
                          try {
                            await api.deleteProxy(p.id);
                          } catch (e) {
                            setError(say(e));
                          }
                          await load();
                        }}
                      />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing !== undefined && (
        <ProxyForm
          editing={editing}
          myEmail={myEmail}
          onClose={() => setEditing(undefined)}
          onSaved={async (id) => {
            onProxySaved?.(id);
            setEditing(undefined);
            await load();
          }}
        />
      )}

      {pasting && (
        <ProxyPaste onClose={() => setPasting(false)} onSaved={() => void load()} />
      )}
    </>
  );
}
