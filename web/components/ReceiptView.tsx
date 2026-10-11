"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { blocks, seconds } from "@/lib/format";
import { useLive } from "@/lib/live";
import type { Receipt } from "@/lib/types";
import { Journey } from "./Journey";
import { PrinterWaiting } from "./Receipt";
import { Explanation, landedIn, Ticket, TicketActions } from "./Ticket";
import s from "./SendTest.module.css";

export function ReceiptView({ signature }: { signature: string }) {
  const price = useLive((st) => st.solPrice);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api
        .receipt(signature)
        .then((r) => {
          if (!alive) return;
          setReceipt(r);
          if (!r.settled) timer = setTimeout(load, 1_000);
        })
        .catch((e) => {
          if (!alive) return;
          if (e instanceof ApiError && e.status === 404) setMissing(true);
          else setFailed(true);
        });
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [signature]);

  if (missing)
    return (
      <div className={s.page}>
        <h1 className="h2">Tipwise has no receipt for this signature.</h1>
        <p className="muted" style={{ marginTop: 12, maxWidth: "60ch" }}>
          Receipts exist for transactions sent through Tipwise. <Link href="/send">Send a test</Link> to get one.
        </p>
      </div>
    );
  if (failed)
    return (
      <div className={s.page}>
        <h1 className="h2">This receipt could not be loaded right now.</h1>
        <p className="muted" style={{ marginTop: 12 }}>
          Tipwise may be restarting. Reload the page in a moment.
        </p>
      </div>
    );
  if (!receipt)
    return (
      <div className={s.page}>
        <PrinterWaiting>Finding the receipt</PrinterWaiting>
      </div>
    );
  const land = landedIn(receipt);
  return (
    <div className={s.page}>
      <p className="small muted">Receipt</p>
      <h1 className="h1" style={{ marginTop: 8 }}>
        {land && !receipt.failure ? `Landed in ${blocks(land.blocks)} (${seconds(land.ms)})` : receipt.failure ? "It did not land." : "On its way"}
      </h1>
      <div className={s.result} style={{ marginTop: 40 }}>
        <Journey receipt={receipt} />
        <div className={s.settled}>
          <div className={s.ticket}>
            <Ticket receipt={receipt} price={price} print={false} />
          </div>
          <div className={s.words}>
            <Explanation receipt={receipt} />
            <TicketActions receipt={receipt} />
          </div>
        </div>
      </div>
    </div>
  );
}
