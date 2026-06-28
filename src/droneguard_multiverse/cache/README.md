# Cache

Store Cerebras requests and responses so the demo can run in replay mode.

Cache entries should include:

- scenario ID
- agent name
- prompt version
- model ID
- reasoning setting
- request payload
- raw response
- normalized output
- response time
- created timestamp

Replay mode should return the cached response after waiting for the recorded response time.

