import asyncio,contextlib,importlib.util,json,os,time,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('v4bridge',ROOT/'bid3_bridge.py');bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)

class BridgeTests(unittest.IsolatedAsyncioTestCase):
 async def test_real_serial_short_lines_return_without_batch_timeout(self):
  master,slave=os.openpty();path=os.ttyname(slave);q=asyncio.Queue();g=bridge.Gateway(path,115200,asyncio.get_running_loop(),q)
  g.start()
  try:
   kind,state=await asyncio.wait_for(q.get(),2);self.assertEqual((kind,state),('gateway','ok'))
   durations=[]
   for i in range(12):
    line='AUCTION_STATUS_JSON='+json.dumps({'build':'V4_WORKING_BASE','running':True,'i':i},separators=(',',':'))
    began=time.monotonic();os.write(master,(line+'\n').encode());kind,received=await asyncio.wait_for(q.get(),1)
    durations.append(time.monotonic()-began);self.assertEqual((kind,received),('line',line))
   self.assertGreater(g.last_status_at,0)
   self.assertLess(max(durations),0.25) # Old read(256)/500 ms behavior fails this test.
   print('PTY short-line latency max_ms=%.3f'%(max(durations)*1000))
  finally:
   g.stop();await asyncio.sleep(.1)
   if g._serial:g._serial.close()
   os.close(master);os.close(slave)
 async def test_session_echo_does_not_mix_reused_sequences(self):
  inbox=asyncio.Queue();written=asyncio.Queue()
  class Gateway:
   connected=True
   def write_line(self,line):written.put_nowait(line)
  class WS:
   def __init__(self):self.incoming=asyncio.Queue()
   def __aiter__(self):return self
   async def __anext__(self):return await self.incoming.get()
   async def ping(self):
    f=asyncio.get_running_loop().create_future();f.set_result(None);return f
   async def send(self,line):
    m=json.loads(line)
    if m.get('type')=='intent':
     e=m['intent'];self.incoming.put_nowait(json.dumps({'type':'ack','tag':e['tag'],'seq':e['seq'],'kind':e['kind'],'result':'ACCEPTED','reason':None}))
  ws=WS()
  class Connection:
   async def __aenter__(self):return ws
   async def __aexit__(self,*_):return False
  with patch.object(bridge.websockets,'connect',lambda *a,**kw:Connection()):
   task=asyncio.create_task(bridge.run('ws://test.invalid','test',Gateway(),inbox))
   try:
    for sid in ['a'*81,'b'*81]:
     await inbox.put(('line','AUCTION_EVENT_JSON='+json.dumps({'kind':'JOIN','tag':'TAG1','session':sid,'seq':1})))
    acks=[]
    while len(acks)<2:
     line=await asyncio.wait_for(written.get(),2)
     if line.startswith('AUCTION_ACK_JSON='):acks.append(json.loads(line.split('=',1)[1]))
    self.assertEqual([a['session'] for a in acks],['a'*81,'b'*81])
   finally:
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):await task

if __name__=='__main__':unittest.main()
