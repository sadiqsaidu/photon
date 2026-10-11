"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/api";
import { isAddress, shortAddress } from "@/lib/format";
import s from "./CheckForm.module.css";

type Example = { address: string; tips: number };

export function CheckForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const id = useId();
  const { publicKey } = useWallet();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<Example[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .examples()
        .then((e) => alive && setExamples(e))
        .catch(() => alive && setExamples((x) => x ?? []));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!isAddress(v)) return setError("That is not a Solana wallet address. It should be 32 to 44 letters and numbers.");
    router.push(`/check/${v}`);
  };

  return (
    <div className={s.form}>
      <form onSubmit={submit} noValidate>
        <label htmlFor={id} className="sr-only">
          Wallet address
        </label>
        <div className={s.row}>
          <input
            id={id}
            className="input"
            placeholder="Paste a Solana wallet address"
            value={value}
            autoFocus={autoFocus}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          <button className="btn primary" type="submit">
            Check wallet
          </button>
        </div>
        {error && (
          <p id={`${id}-err`} className={`error ${s.err}`} role="alert">
            {error}
          </p>
        )}
      </form>
      {publicKey && (
        <button type="button" className={`chip ${s.mine}`} onClick={() => router.push(`/check/${publicKey.toBase58()}`)}>
          Check my connected wallet <span>{shortAddress(publicKey.toBase58())}</span>
        </button>
      )}
      <div className={s.bots}>
        <p>Or pick a bot that tipped in the last few minutes:</p>
        <ul>
          {examples === null
            ? [0, 1, 2].map((i) => (
                <li key={i}>
                  <span className={`chip ${s.ghost}`}>&nbsp;</span>
                </li>
              ))
            : examples.map((e) => (
                <li key={e.address}>
                  <button type="button" className="chip" onClick={() => router.push(`/check/${e.address}`)}>
                    {shortAddress(e.address)}
                    <span>{e.tips.toLocaleString("en-US")} tips</span>
                  </button>
                </li>
              ))}
          {examples?.length === 0 && <li className={s.none}>None right now. They appear as soon as the live feed sees tips.</li>}
        </ul>
      </div>
    </div>
  );
}
