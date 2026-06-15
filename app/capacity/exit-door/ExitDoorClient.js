'use client';

import { useState } from 'react';
import { useCapacity } from '../useCapacity';
import CounterShell from '../CounterShell';
import DeviceUnauthorized from '../DeviceUnauthorized';

export default function ExitDoorClient({ token = null }) {
  const { status, connected, loading, error, unauthorized, runOp } = useCapacity({ token });
  const [lastAction, setLastAction] = useState('');

  if (unauthorized) {
    return <DeviceUnauthorized door="Exit Door" />;
  }

  const noSession = status.status === 'none';
  const atZero = status.atZero;

  async function handleCheckOut() {
    const res = await runOp('check_out', { source: 'exit_door' });
    if (res.ok) {
      setLastAction(`Out · ${res.status?.count}/${res.status?.max} · ${time()}`);
    } else if (res.code === 'empty') {
      setLastAction('Count already at zero.');
    }
  }

  return (
    <CounterShell
      title="Exit Door · Check Out"
      accent="red"
      status={status}
      connected={connected}
      loading={loading}
      error={error}
      lastAction={lastAction}
      buttonLabel={atZero ? 'EMPTY' : '– CHECK OUT'}
      buttonDisabled={loading || noSession || atZero}
      onAction={handleCheckOut}
    />
  );
}

function time() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
