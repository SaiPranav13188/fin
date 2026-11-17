/** Android home-screen widget: what you owe and what you're owed, with the mascot. Tap to open Fin. */
import React from 'react';
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

export type WidgetData = { signedIn: boolean; owePaise: number; owedPaise: number; updated: string; offline?: boolean };

const MASCOT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 130">
<path d="M60 12 Q46 2 40 12 Q50 20 60 12 Z" fill="#19C08A"/><path d="M60 10 Q72 -2 82 8 Q72 18 60 10 Z" fill="#3BD79B"/>
<path d="M60 24 Q59 14 60 8" stroke="#12996D" stroke-width="3" fill="none"/>
<circle cx="60" cy="72" r="50" fill="#F0A019"/><circle cx="60" cy="69" r="50" fill="#FFCF4A"/>
<circle cx="60" cy="69" r="41" fill="none" stroke="#FFE9A0" stroke-width="2.5"/>
<path d="M36 64 Q44 54 52 64" stroke="#3A2408" stroke-width="3.6" fill="none" stroke-linecap="round"/>
<path d="M68 64 Q76 54 84 64" stroke="#3A2408" stroke-width="3.6" fill="none" stroke-linecap="round"/>
<path d="M48 78 Q60 92 72 78 Q60 84 48 78 Z" fill="#8A4B12"/>
<ellipse cx="32" cy="76" rx="7" ry="4.5" fill="#FF9EC4"/><ellipse cx="88" cy="76" rx="7" ry="4.5" fill="#FF9EC4"/></svg>`;

function rupees(paise: number) {
  const r = Math.round(Math.abs(paise) / 100);
  let s = String(r);
  if (s.length > 3) s = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  return '₹' + s;
}

export function BalanceWidget({ data }: { data: WidgetData }) {
  const square = data.signedIn && !data.owePaise && !data.owedPaise;
  return (
    <FlexWidget clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 24,
        backgroundGradient: { from: '#FF6FB1', to: '#9B5CFF', orientation: 'TL_BR' } }}>
      <SvgWidget svg={MASCOT} style={{ height: 64, width: 60 }} />
      <FlexWidget style={{ flex: 1, flexDirection: 'column', marginLeft: 12 }}>
        {!data.signedIn ? (
          <TextWidget text="Open Fin to sign in" style={{ fontSize: 15, color: '#FFFFFF', fontWeight: 'bold' }} />
        ) : square ? (
          <TextWidget text="You're square ✓" style={{ fontSize: 18, color: '#FFFFFF', fontWeight: 'bold' }} />
        ) : (
          <FlexWidget style={{ flexDirection: 'row' }}>
            <FlexWidget style={{ flexDirection: 'column', marginRight: 18 }}>
              <TextWidget text="YOU OWE" style={{ fontSize: 10, color: '#FFE4F1', fontWeight: 'bold', letterSpacing: 0.08 }} />
              <TextWidget text={rupees(data.owePaise)} style={{ fontSize: 20, color: '#FFFFFF', fontWeight: 'bold' }} />
            </FlexWidget>
            <FlexWidget style={{ flexDirection: 'column' }}>
              <TextWidget text="YOU'RE OWED" style={{ fontSize: 10, color: '#FFE4F1', fontWeight: 'bold', letterSpacing: 0.08 }} />
              <TextWidget text={rupees(data.owedPaise)} style={{ fontSize: 20, color: '#FFFFFF', fontWeight: 'bold' }} />
            </FlexWidget>
          </FlexWidget>
        )}
        <TextWidget text={data.offline ? 'Offline · last known' : `Updated ${data.updated}`} style={{ fontSize: 10, color: '#FFE4F1', marginTop: 4 }} />
      </FlexWidget>
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'fin://assistant' }}
        style={{ height: 44, width: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
        <TextWidget text="🎙️" style={{ fontSize: 20 }} />
      </FlexWidget>
    </FlexWidget>
  );
}
