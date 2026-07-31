import httpx

resp = httpx.post(
    "https://medicbolivia.com/api/v1/bank-integration/login",
    json={"userName": "medicbolivia_443273", "password": "8+u6XEXdvjU1k%Z1bvwePtNc2j!o"},
    timeout=15.0,
)
print("STATUS:", resp.status_code)
print("BODY:", resp.json())