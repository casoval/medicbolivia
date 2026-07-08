import asyncio
from livekit import api as lk

async def test():
    async with lk.LiveKitAPI(
        url='https://asistente-voz-27m9jmdw.livekit.cloud',
        api_key='APIlpaKQMHw9v7c',
        api_secret='iCFI1FuZKZeVSsH3NaeiEFHnsMceysPkfYO1N74e9atE',
    ) as client:
        rooms = await client.room.list_rooms(lk.ListRoomsRequest())
        print('OK:', rooms)

asyncio.run(test())
