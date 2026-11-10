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
import type { ProxyOperation } from "../proxyCheck";

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
  onRotateProxy,
  proxyOperationFor,
  onProxySaved,
}: {
  profiles: Profile[];
  local: boolean;
  myEmail?: string | null;
  /** Team checks require the same organisation-wide secret permission as the
   * sealed credential endpoint. */
  canCheck: boolean;
  /** Rotation remains local until the team server grows a matching endpoint. */
  canRotate: boolean;
  /** The parent owns requests so profile and proxy rows share one result. */
  onCheckProxy: (proxy: LocalProxy) => Promise<boolean>;
  onRotateProxy: (proxy: LocalProxy) => Promise<boolean>;
  proxyOperationFor: (proxy: LocalProxy) => ProxyOperation | undefined;
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

  const checkAll = async () => {
    if (!canCheck) return;
    const list = rows.filter((proxy) => proxyOperationFor(proxy)?.status !== "pending");
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
        changed = (await onCheckProxy(proxy)) || changed;
        done++;
        setChecking({ done, total: list.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setChecking(null);
    if (changed) await load();
  };

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

  const usedBy = (id: string) => profiles.filter((p) => p.proxy?.id === id).length;
  const checkResults = rows.reduce<ProxyOperation[]>((results, proxy) => {
    const operation = proxyOperationFor(proxy);
    if (operation?.action === "check" && operation.status !== "pending") results.push(operation);
    return results;
  }, []);

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
            {t("px.checkSummary", { ok: checkResults.filter((check) => check.status === "ok").length, bad: checkResults.filter((check) => check.status === "error").length })}
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
                const operation = proxyOperationFor(p);
                const check = operation?.action === "check" ? operation : undefined;
                const rotation = operation?.action === "rotate" ? operation : undefined;
                const operationPending = operation?.status === "pending";
                const checkState = check?.status === "pending" ? "checking" : check?.status ?? "idle";
                const rotationState = rotation?.status === "pending" ? "rotating" : rotation?.status ?? "idle";
                const observedExit = operation?.exit === undefined
                  ? { ip: p.last_ip, country: p.last_country }
                  : operation.exit;
                const locked = proxyLock(p, myEmail, t);
                const checkLabel = checkState === "checking" ? t("px.checking") : t("px.check");
                const checkTitle = check?.status === "ok"
                  ? t("px.checkOk", { ms: check.ms ?? 0 })
                  : check?.status === "error"
                    ? check.error ?? t("px.checkBad")
                    : checkLabel;
                const rotationLabel = rotationState === "rotating" ? t("px.rotating") : t("px.rotateNow");
                const rotationTitle = rotation?.status === "ok"
                  ? t("px.rotated")
                  : rotation?.status === "error"
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
                      {observedExit?.ip ?? "—"}
                      {observedExit?.country && (
                        <>
                          {" · "}
                          <span className="flag">{flag(observedExit.country)}</span> {observedExit.country}
                        </>
                      )}
                      {check && check.status !== "pending" && (check.status === "ok" ? (
                        <div className="ok">{t("px.checkOk", { ms: check.ms ?? 0 })}</div>
                      ) : (
                        <div className="warn" title={check.error}>{t("px.checkBad")}</div>
                      ))}
                      {rotation && rotation.status !== "pending" && (rotation.status === "ok" ? (
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
                        <span className={`proxyTableCheck proxyCheck-${checkState}`}>
                          <IconButton
                            icon="check"
                            label={checkLabel}
                            title={checkTitle}
                            disabled={operationPending}
                            onClick={() => void onCheckProxy(p)}
                          />
                        </span>
                      )}
                      {canRotate && !!p.rotate_url && locked === null && (
                        <span className={`proxyTableRotate proxyRotate-${rotationState}`}>
                          <IconButton
                            icon="refresh"
                            label={rotationLabel}
                            title={rotationTitle}
                            disabled={operationPending}
                            onClick={() => void onRotateProxy(p)}
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
