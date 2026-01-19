"""
URL configuration for newsradar project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path

from newsradar.accounts.api import api as accounts_api
from newsradar.accounts.views import SesameLoginView
from newsradar.contents.api import api as contents_api
from newsradar.executions.api import api as executions_api
from newsradar.topics.api import api as topics_api


urlpatterns = [
    path('nrAdmin/', admin.site.urls),
    path('api/auth/sesame/', SesameLoginView.as_view(), name='sesame-login'),
    path('api/auth/', accounts_api.urls),
    path('api/contents/', contents_api.urls),
    path('contents/', contents_api.urls),
    path('api/executions/', executions_api.urls),
    path('api/topics/', topics_api.urls),
]


admin.site.index_title = 'Welcome to News Radar'
admin.site.site_header = 'News Radar Administration'
admin.site.site_title = 'News Radar Administration'
