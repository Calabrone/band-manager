FROM php:8.3-apache
RUN a2enmod rewrite headers \
 && sed -ri 's#AllowOverride None#AllowOverride All#' /etc/apache2/apache2.conf \
 && echo "upload_max_filesize=128M\npost_max_size=130M" > /usr/local/etc/php/conf.d/upload.ini
RUN mkdir -p /var/www/html/band/api/data && chown www-data:www-data /var/www/html/band/api/data
