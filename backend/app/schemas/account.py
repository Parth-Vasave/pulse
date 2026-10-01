from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class ChangeEmailIn(BaseModel):
    new_email: EmailStr
    current_password: str = Field(max_length=128)

    @field_validator("new_email")
    @classmethod
    def lower(cls, v: str) -> str:
        return v.lower()


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=10, max_length=128)

    @model_validator(mode="after")
    def differs(self) -> "ChangePasswordIn":
        if self.new_password == self.current_password:
            raise ValueError("new password must be different from the current password")
        return self


class DeleteAccountIn(BaseModel):
    current_password: str = Field(max_length=128)
