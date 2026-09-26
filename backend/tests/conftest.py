import os
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"
FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
load_dotenv(BACKEND_ENV)
load_dotenv(FRONTEND_ENV)

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TEST_USER_ID = "user_test123"
TEST_EMAIL = "tester@example.com"
TEST_TOKEN = "test-token-abc"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def mongo():
    c = MongoClient(MONGO_URL)
    return c[DB_NAME]


@pytest.fixture(scope="session", autouse=True)
def seed_user(mongo):
    # Clean prior test artifacts
    mongo.user_sessions.delete_many({"user_id": TEST_USER_ID})
    mongo.users.delete_many({"user_id": TEST_USER_ID})
    mongo.goals.delete_many({"user_id": TEST_USER_ID})
    mongo.messages.delete_many({"user_id": TEST_USER_ID})
    mongo.task_logs.delete_many({"user_id": TEST_USER_ID})
    mongo.checkins.delete_many({"user_id": TEST_USER_ID})

    now = datetime.now(timezone.utc)
    mongo.users.insert_one({
        "user_id": TEST_USER_ID,
        "email": TEST_EMAIL,
        "name": "Tester",
        "picture": "",
        "created_at": now.isoformat(),
    })
    mongo.user_sessions.insert_one({
        "session_token": TEST_TOKEN,
        "user_id": TEST_USER_ID,
        "created_at": now,
        "expires_at": now + timedelta(days=7),
    })
    yield
    # teardown
    mongo.user_sessions.delete_many({"user_id": TEST_USER_ID})
    mongo.users.delete_many({"user_id": TEST_USER_ID})
    mongo.goals.delete_many({"user_id": TEST_USER_ID})
    mongo.messages.delete_many({"user_id": TEST_USER_ID})
    mongo.task_logs.delete_many({"user_id": TEST_USER_ID})
    mongo.checkins.delete_many({"user_id": TEST_USER_ID})


@pytest.fixture(scope="session")
def auth_client():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TEST_TOKEN}",
    })
    return s


@pytest.fixture(scope="session")
def plain_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# Shared state between ordered tests
@pytest.fixture(scope="session")
def state():
    return {}
