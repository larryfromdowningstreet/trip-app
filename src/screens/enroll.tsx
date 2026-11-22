// Building the whitelist face to face. Everyone takes a turn holding up their identity QR Code while the
// others scan it; then an organizer shows the invite, which brings newcomers in and sets everyone's role.

import { useState } from 'preact/hooks';
import { type JoinResult, app } from '../app/store';
import { initial } from '../app/trip';
import type { Bytes } from '../core/bytes';
import { whitelistCode } from '../core/codes';
import type { PublicIdentity } from '../core/crypto';
import { EnrollFailure, ROLES, type Role, identityCard, readIdentityCard } from '../core/enroll';
import { kindOf } from '../core/transfer';
import { Icon } from '../ui/icons';
import { BackBar, Segmented, useAsync } from '../ui/kit';
import { QrShow, Scanner } from '../ui/qr';

type Phase = 'rounds' | 'roles' | 'showInvite' | 'scanInvite' | 'done';

const ENROLL_ERRORS: Record<EnrollFailure['code'], string> = {
  'unknown-inviter': '還沒和這位主揪互掃過，或主揪還沒掃到你。請先完成互掃。',
  'bad-signature': '簽章不符，邀請可能被改過，已拒絕。',
  'other-trip': '這是別趟旅程的邀請。',
  format: '看不懂這個 QR Code。',
  'too-large': '資料太大，已拒絕。',
};

export function Enroll({ join }: { join?: boolean }) {
  const inTrip = !join && !!app.trip;
  const [phase, setPhase] = useState<Phase>('rounds');
  const [mode, setMode] = useState<'scan' | 'show'>('scan');
  const [scanned, setScanned] = useState<PublicIdentity[]>([]);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [invite, setInvite] = useState<Bytes>();
  const [result, setResult] = useState<JoinResult>();
  const me = app.me;
  const members = inTrip ? app.trip!.data.members : [];
  const present = [me, ...scanned];
  const code = useAsync(() => whitelistCode(present), [scanned]);
  const card = useAsync(async () => identityCard(me), []);
  const newcomers = scanned.filter((p) => !members.some((m) => m.id === p.id));

  const onIdentity = async (bytes: Bytes) => {
    if (kindOf(bytes) !== 'identity') throw new Error('這不是身分 QR Code。請對方切到「顯示我的」。');
    const person = await readIdentityCard(bytes).catch(() => Promise.reject(new Error('看不懂這個身分 QR Code。')));
    if (person.id === me.id) return undefined;
    const sameName = [...present, ...members].find((p) => p.name === person.name && p.id !== person.id);
    if (sameName) throw new Error(`已經有一位「${person.name}」了，名字重複會分不清楚。請其中一人到「設定」改暱稱，再掃一次。`);
    const again = scanned.some((p) => p.id === person.id);
    setScanned((list) => [...list.filter((p) => p.id !== person.id), person]);
    return again ? `${person.name}已經掃過了` : `已加入${person.name}`;
  };

  const onInvite = async (bytes: Bytes) => {
    if (kindOf(bytes) !== 'invite') throw new Error('這不是邀請 QR Code。請主揪按「顯示邀請 QR Code」。');
    try {
      setResult(await app.acceptInvite(bytes, scanned));
      setPhase('done');
      return undefined;
    } catch (e) {
      throw new Error(e instanceof EnrollFailure ? ENROLL_ERRORS[e.code] : String(e));
    }
  };

  const showInvite = async () => {
    // Everyone scanned goes in: newcomers with the role picked, members as they are (and with any new nickname).
    const roleOf = (id: string): Role => roles[id] ?? (members.find((m) => m.id === id)?.trust.access === 'edit' ? 'organizer' : 'member');
    setInvite(await app.invite(scanned.map((person) => ({ person, role: roleOf(person.id) }))));
    setPhase('showInvite');
  };

  const next = () => setPhase(inTrip && app.isOrganizer ? 'roles' : 'scanInvite');

  return (
    <div class="screen">
      <BackBar title="建立白名單" />
      <main class="body end">
        {phase === 'rounds' && (
          <>
            <h1 class="title">輪流舉手機互掃</h1>
            <p class="small muted">一人舉著自己的身分 QR Code，其他人同時掃。每個人都要輪到一次。</p>
            <Segmented label="現在要" options={[['scan', '掃描別人'], ['show', '顯示我的']] as const} value={mode} onPick={setMode} />
            {mode === 'scan'
              ? <Scanner prompt="對準別人的身分 QR Code" onBytes={onIdentity} />
              : <QrShow bytes={card} />}
            {mode === 'show' && <p class="awake"><Icon name="info" />身分 QR Code 只有暱稱和公鑰，被拍到也沒關係</p>}
            <PeopleList people={present} />
            <div class="card pad spread">
              <span class="stack" style={{ gap: '2px' }}>
                <span class="small muted">白名單碼</span>
                <span class="tiny muted">大家都輪過後，在場每個人的碼要一樣</span>
              </span>
              <b class="code">{code ?? '····'}</b>
            </div>
            <button class="btn primary tall push-end" disabled={scanned.length === 0} onClick={next}>大家都輪過了，下一步</button>
          </>
        )}

        {phase === 'roles' && (
          <>
            <h1 class="title">新成員的角色</h1>
            <p class="small muted">主揪可以修改行程；成員只能看。之後在「成員」也能改。</p>
            {newcomers.length === 0 && <p class="note soft"><Icon name="info" />這次沒有新加入的人，邀請只用來讓大家更新名單。</p>}
            <ul class="card rows">
              {newcomers.map((p) => (
                <li class="member">
                  <div class="member-head"><span class="avatar" aria-hidden="true">{initial(p.name)}</span><span class="member-name">{p.name}</span></div>
                  <Segmented label={`${p.name}的角色`} options={ROLES} value={roles[p.id] ?? 'member'} onPick={(r) => setRoles({ ...roles, [p.id]: r })} />
                </li>
              ))}
            </ul>
            <div class="stack push-end">
              <button class="btn primary tall" onClick={showInvite}>顯示邀請 QR Code</button>
              <button class="btn plain" onClick={() => setPhase('scanInvite')}>改掃別的主揪的邀請</button>
            </div>
          </>
        )}

        {phase === 'showInvite' && (
          <>
            <h1 class="title">請大家掃邀請</h1>
            <p class="small muted">新加入的人掃了就會加入「{app.trip!.meta.name}」。已經在旅程裡的人也掃一下，名單和角色才會一致。</p>
            <QrShow bytes={invite} />
            <button class="btn primary tall push-end" onClick={() => app.reset({ to: 'members' })}>大家都掃好了</button>
          </>
        )}

        {phase === 'scanInvite' && (
          <>
            <h1 class="title">掃描主揪的邀請</h1>
            <p class="small muted">請主揪按「顯示邀請 QR Code」，然後掃他的畫面。</p>
            <Scanner prompt="對準主揪的邀請 QR Code" onBytes={onInvite} />
            <button class="btn plain push-end" onClick={() => setPhase('rounds')}>回到互掃</button>
          </>
        )}

        {phase === 'done' && result && (
          <>
            <span class="circle-icon" aria-hidden="true"><Icon name="check" size={26} /></span>
            <h1 class="title">{result.joined ? `已加入「${result.name}」` : '名單已更新'}</h1>
            {result.added.length > 0 && <p class="muted">加入白名單：{result.added.join('、')}</p>}
            {result.skipped.length > 0 && (
              <p class="note warn"><Icon name="warn" />{result.skipped.join('、')}這次沒有和你互掃，先不加入。下次見面再互掃一次。</p>
            )}
            <button class="btn primary tall push-end" onClick={() => app.reset(result.joined ? { to: 'sync' } : { to: 'members' })}>
              {result.joined ? '接著同步，拿到行程' : '回到成員'}
            </button>
          </>
        )}
      </main>
    </div>
  );
}

function PeopleList({ people }: { people: PublicIdentity[] }) {
  return (
    <ul class="card rows" aria-label="這次掃到的人">
      {people.map((p, i) => (
        <li class="status-row">
          <span class="avatar" aria-hidden="true">{initial(p.name)}</span>
          <span class="name">{p.name}{i === 0 && '（你）'}</span>
          <span class="state">{i === 0 ? '' : '已掃描'}</span>
        </li>
      ))}
    </ul>
  );
}
