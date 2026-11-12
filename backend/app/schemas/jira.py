from datetime import date

from pydantic import BaseModel, Field


class JiraCredentials(BaseModel):
    url: str = Field(min_length=1, max_length=500)
    email: str = Field(min_length=3, max_length=320)
    token: str = Field(min_length=1, max_length=4096)


class JiraTeamRequest(BaseModel):
    project_key: str = Field(min_length=1, max_length=50)
    start_date: date


class JiraProjectRequest(BaseModel):
    project_key: str = Field(min_length=1, max_length=50)


class JiraPeopleRequest(BaseModel):
    project_key: str = Field(min_length=1, max_length=50)
    team_name: str = Field(min_length=1, max_length=200)
    team_id: str | None = Field(default=None, min_length=1, max_length=255)


class JiraIterationFiltersRequest(BaseModel):
    project_key: str = Field(min_length=1, max_length=50)
    team_name: str = Field(min_length=1, max_length=200)
    start_date: date
    end_date: date


class JiraIterationExtractRequest(JiraIterationFiltersRequest):
    quarters: list[str] = Field(default_factory=list)
    sprint_ids: list[str] = Field(default_factory=list)


class JiraIssueLookupRequest(BaseModel):
    issue_key: str = Field(
        min_length=3,
        pattern=r"^[A-Za-z][A-Za-z0-9_]*-\d+$",
        examples=["TECNA-6231"],
    )
