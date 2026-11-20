import { useEffect, useState } from "react";
import { apiRequest, type ApiEnvelope } from "../services/api";

interface Reading {
  sensorId: string; sequence: number; temperatureC: number; recordedAt: number;
  status: "ALERT" | "NORMAL"; source: string | null; calibration: string | null;
}

export default function TemperatureHistory({tokenId}: {tokenId: string}) {
  const [rows, setRows] = useState<Reading[]>([]);
  const [rejected, setRejected] = useState("");
  const [message, setMessage] = useState("Loading readings…");
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<ApiEnvelope<Reading[]>>(`/api/v1/oracle/batches/${tokenId}`, {signal: controller.signal})
      .then(({data, meta}) => {
        if (controller.signal.aborted) return;
        const last = meta?.lastRejection as {reason?: string; at?: string} | undefined;
        setRejected(last?.reason ? `Signed reading rejected · ${last.reason} · ${last.at} UTC` : "");
        setRows(data);
        setMessage(data.length ? "" : "No signed readings recorded.");
      }).catch(() => {
        if (!controller.signal.aborted) setMessage("Temperature readings unavailable.");
      });
    return () => controller.abort();
  }, [tokenId]);
  return <section className="detail-section"><h3>Storage temperature</h3>
    {message && <p>{message}</p>}
    {rejected && <p role="status">{rejected}</p>}
    {rows.map(row => <p key={row.sensorId + ":" + row.sequence}>
      <strong>{row.temperatureC} °C · {row.status}</strong><br/>
      {row.sensorId} · {new Date(row.recordedAt * 1000).toLocaleString()}<br/>
      {row.source} · {row.calibration}
    </p>)}
    {rows.length > 0 && <small>Demo range 2–8 °C. A signature verifies the source and integrity of a reading. Physical accuracy requires independent calibration.</small>}
  </section>;
}
