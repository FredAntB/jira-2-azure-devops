# Overview

This project is intended for users who intend to migrate project planning from jira to azure devops on an easy way.

The provided implementation allows to run the whole project on docker using docker compose.

Please follow this steps for a proper use:

- clone the repository.
- turn on your docker engine.
- open a terminal on the main directory (the cloned repository's directory).
- use the command _docker-compose up --build -d_
- once everything is up and running, go to:
- http://localhost:4000 if run locally

```
Note: if you wanna run on a different port specify it on the docker-compose file
```

# Limitations

---

- There is no OAuth implementation.
- It is not possible to migrate jira issues without migrating custom fields.
-
