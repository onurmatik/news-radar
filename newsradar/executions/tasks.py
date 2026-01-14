from celery import shared_task

from newsradar.executions.services import execute_web_search


@shared_task(name="executions.web_search_execution")
def web_search_execution(
    keyword_uuid: str,
    origin_type: str = "user",
) -> dict:
    return execute_web_search(keyword_uuid, origin_type=origin_type)
