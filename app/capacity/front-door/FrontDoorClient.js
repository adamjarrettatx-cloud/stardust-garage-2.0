'use client';

import { useState } from 'react';
import { useCapacity } from '../useCapacity';
import CounterShell from '../CounterShell';
import DeviceUnauthorized from '../DeviceUnauthorized';

export default function FrontDoorClient({ token = null }) {
  const { status, connected, loading, error, unauthorized, runOp } = useCapacity({ token });
  const [lastAction, setLastAction] = useState('');

  if (unauthorized) {
    return <DeviceUnauthorized door="Front Door" />;
  }

  const noSession = status.status === 'none';
  const atMax = status.atMax;

  async function handleCheckIn() {
    const res = await runOp('check_in', { source: 'front_door' });
    if (res.ok) {
      setLastAction(`In · ${res.status?.count}/${res.status?.max} · ${time()}`);
    } else if (res.code === 'full') {
      setLastAction('At capacity — cannot check in.');
    }
  }

  return (
    <CounterShell
      title="Front Door · Check In"
      accent="green"
      status={status}
      connected={connected}
      loading={loading}
      error={error}
      lastAction={lastAction}
      buttonLabel={atMax ? 'FULL' : '+ CHECK IN'}
      buttonDisabled={loading || noSession || atMax}
      onAction={handleCheckIn}
    />
  );
}

function time() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
